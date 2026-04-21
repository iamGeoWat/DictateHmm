import type { Plugin } from 'vite';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

type IncomingMsg = import('node:http').IncomingMessage;
type ServerResp = import('node:http').ServerResponse;

const EVAL_DIR = path.resolve(process.cwd(), 'eval');
const DATASETS = path.join(EVAL_DIR, 'datasets');
const RECORDINGS = path.join(DATASETS, 'recordings');
const RESULTS = path.join(EVAL_DIR, 'results');
const LABELS = path.join(DATASETS, 'labels.json');
const PHRASES = path.join(DATASETS, 'phrases.json');

let labelsChain: Promise<void> = Promise.resolve();

export function vitePluginEvalIO(): Plugin {
  return {
    name: 'dictatehmm-eval-io',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__eval/phrases.json', handler(async (_req, res) => {
        const data = await readJsonOrDefault(PHRASES, []);
        sendJson(res, data);
      }));

      server.middlewares.use('/__eval/labels.json', handler(async (_req, res) => {
        const data = await readJsonOrDefault(LABELS, []);
        sendJson(res, data);
      }));

      server.middlewares.use('/__eval/save-wav', handler(async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, 'method not allowed');
        const body = await readBody(req);
        const { filename, base64Wav } = JSON.parse(body);
        if (!/^[a-z0-9_]+\.wav$/i.test(filename)) return send(res, 400, 'bad filename');
        await fs.mkdir(RECORDINGS, { recursive: true });
        const bytes = Buffer.from(base64Wav, 'base64');
        await fs.writeFile(path.join(RECORDINGS, filename), bytes);
        sendJson(res, { ok: true, path: `eval/datasets/recordings/${filename}` });
      }));

      server.middlewares.use('/__eval/append-labels', handler(async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, 'method not allowed');
        const body = await readBody(req);
        const { entry } = JSON.parse(body);
        if (!entry || typeof entry.id !== 'string' || typeof entry.file !== 'string') {
          return send(res, 400, 'bad entry');
        }
        labelsChain = labelsChain.then(async () => {
          await fs.mkdir(DATASETS, { recursive: true });
          const existing = await readJsonOrDefault<unknown[]>(LABELS, []);
          existing.push(entry);
          await fs.writeFile(LABELS, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
        });
        await labelsChain;
        sendJson(res, { ok: true });
      }));

      server.middlewares.use('/__eval/save-results', handler(async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, 'method not allowed');
        const body = await readBody(req);
        const payload = JSON.parse(body);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const gitSha = tryGitSha();
        const filename = `${ts}.json`;
        await fs.mkdir(RESULTS, { recursive: true });
        await fs.writeFile(
          path.join(RESULTS, filename),
          JSON.stringify({ ...payload, gitSha }, null, 2) + '\n',
          'utf-8',
        );
        sendJson(res, { ok: true, filename });
      }));

      server.middlewares.use('/__eval/recordings', handler(async (req, res) => {
        const url = req.url || '';
        const m = url.match(/^\/([a-z0-9_]+\.wav)$/i);
        if (!m) return send(res, 404, 'not found');
        const full = path.join(RECORDINGS, m[1]);
        if (!existsSync(full)) return send(res, 404, 'not found');
        const data = await fs.readFile(full);
        res.statusCode = 200;
        res.setHeader('content-type', 'audio/wav');
        res.end(data);
      }));
    },
  };
}

function handler(
  fn: (req: IncomingMsg, res: ServerResp) => Promise<void>,
): (req: IncomingMsg, res: ServerResp, next: (e?: unknown) => void) => void {
  return (req, res, next) => {
    fn(req, res).catch((e) => {
      console.error('[eval-io]', e);
      try { send(res, 500, String(e?.message ?? e)); } catch { /* ignore */ }
      next(e);
    });
  };
}

async function readBody(req: IncomingMsg): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

async function readJsonOrDefault<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function sendJson(res: ServerResp, body: unknown): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function send(res: ServerResp, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain');
  res.end(body);
}

function tryGitSha(): string | undefined {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}
