import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ToneIndex, ToneLabel } from '../../types';
import { runPipeline } from '../../pipeline';
import { aggregate } from '../metrics';
import { fetchLabels, fetchPhrases, fetchRecording, saveResults } from '../api';
import type { EvalItemInput, EvalRunResult, Label, Phrase } from '../types';

type RunProgress =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; result: EvalRunResult; savedAs: string };

export function EvalRun() {
  const [phrases, setPhrases] = useState<Phrase[] | null>(null);
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [index, setIndex] = useState<ToneIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunProgress>({ kind: 'idle' });

  useEffect(() => {
    (async () => {
      try {
        const [p, l, ir] = await Promise.all([
          fetchPhrases(),
          fetchLabels(),
          fetch('/data/tone-index.json').then((r) => r.json() as Promise<ToneIndex>),
        ]);
        setPhrases(p);
        setLabels(l);
        setIndex(ir);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const pairs = useMemo(() => {
    if (!phrases || !labels) return [];
    const latest = new Map<string, Label>();
    for (const l of labels) {
      const prev = latest.get(l.id);
      if (!prev || prev.recordedAt < l.recordedAt) latest.set(l.id, l);
    }
    const out: Array<{ phrase: Phrase; label: Label }> = [];
    for (const p of phrases) {
      const l = latest.get(p.id);
      if (l) out.push({ phrase: p, label: l });
    }
    return out;
  }, [phrases, labels]);

  const run = useCallback(async () => {
    if (!index || pairs.length === 0) return;
    setError(null);
    setProgress({ kind: 'running', done: 0, total: pairs.length });
    const ac = new AudioContext();
    const items: EvalItemInput[] = [];
    try {
      for (let i = 0; i < pairs.length; i++) {
        const { phrase, label } = pairs[i];
        const buf = await fetchRecording(label.file);
        const audio = await ac.decodeAudioData(buf.slice(0));
        const samples = audio.getChannelData(0);
        const t0 = performance.now();
        const pipeline = runPipeline(new Float32Array(samples), audio.sampleRate, index);
        const latencyMs = performance.now() - t0;

        items.push({
          id: phrase.id,
          file: label.file,
          expected: { text: phrase.text, toneSeq: phrase.toneSeq as ToneLabel[] },
          actual: {
            toneSeq: pipeline.toneSeq,
            toneSeqAlt: pipeline.altToneSeqs,
            top20: pipeline.candidates.slice(0, 20).map((c) => ({
              text: c.text, pinyin: c.pinyin, score: c.score,
            })),
          },
          latencyMs,
        });
        setProgress({ kind: 'running', done: i + 1, total: pairs.length });
      }
      const result = aggregate(items);
      result.indexMeta = { totalPhrases: index.meta.totalPhrases, uniqueToneSeqs: index.meta.uniqueToneSeqs };
      const savedAs = await saveResults(result);
      setProgress({ kind: 'done', result, savedAs });
    } catch (e) {
      setError((e as Error).message);
      setProgress({ kind: 'idle' });
    } finally {
      await ac.close();
    }
  }, [index, pairs]);

  const coverage = phrases && labels
    ? `${pairs.length} / ${phrases.length} 条脚本有录音`
    : '…';

  return (
    <div className="app" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <h1>Eval · 跑评测</h1>
        <Link to="/eval">← eval 首页</Link>
        <span style={{ marginLeft: 'auto', opacity: 0.6 }}>{coverage}</span>
      </header>

      {error && <div className="error">错误：{error}</div>}

      <section style={{ padding: 16 }}>
        <button
          onClick={run}
          disabled={progress.kind === 'running' || !index || pairs.length === 0}
        >
          ▶ Run Eval
        </button>
        {progress.kind === 'running' && (
          <span style={{ marginLeft: 12 }}>
            {progress.done} / {progress.total}
          </span>
        )}
        {progress.kind === 'done' && (
          <span style={{ marginLeft: 12, opacity: 0.7 }}>
            已写入 eval/results/{progress.savedAs}
          </span>
        )}
      </section>

      {progress.kind === 'done' && <SummaryView result={progress.result} />}
    </div>
  );
}

function SummaryView({ result }: { result: EvalRunResult }) {
  const { summary, items } = result;
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <h2>Summary</h2>
        <table>
          <tbody>
            <tr><td>n</td><td>{summary.n}</td></tr>
            <tr><td>Top-1</td><td>{(summary.topK.top1 * 100).toFixed(1)}%</td></tr>
            <tr><td>Top-5</td><td>{(summary.topK.top5 * 100).toFixed(1)}%</td></tr>
            <tr><td>Top-20</td><td>{(summary.topK.top20 * 100).toFixed(1)}%</td></tr>
            <tr><td>段数错误率</td><td>{(summary.segmentCountMismatchRate * 100).toFixed(1)}%</td></tr>
            <tr><td>延迟 p50/p95/mean</td>
                <td>{summary.latencyMs.p50.toFixed(0)} / {summary.latencyMs.p95.toFixed(0)} / {summary.latencyMs.mean.toFixed(0)} ms</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>声调准确率（按位置）</h2>
        <table>
          <thead><tr><th>位置</th><th>准确率</th></tr></thead>
          <tbody>
            {summary.toneAccuracyByPos.map((v, i) => (
              <tr key={i}><td>{i}</td><td>{(v * 100).toFixed(1)}%</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>声调混淆矩阵</h2>
        <table>
          <thead><tr><th>期望→实际</th><th>次数</th></tr></thead>
          <tbody>
            {Object.entries(summary.toneConfusion)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <tr key={k}><td>{k}</td><td>{v}</td></tr>
              ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>按字数拆</h2>
        <table>
          <thead><tr><th>字数</th><th>n</th><th>Top-5</th></tr></thead>
          <tbody>
            {Object.entries(summary.byLen).sort().map(([k, v]) => (
              <tr key={k}><td>{k}</td><td>{v.n}</td><td>{(v.top5 * 100).toFixed(1)}%</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>明细</h2>
        <table>
          <thead>
            <tr>
              <th>id</th><th>期望</th><th>检出声调</th><th>期望声调</th>
              <th>Top-1</th><th>Top-5 / 20</th><th>ms</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const idx = it.actual.top20.findIndex((c) => c.text === it.expected.text);
              const hit1 = idx === 0;
              const hit5 = idx >= 0 && idx < 5;
              const hit20 = idx >= 0 && idx < 20;
              return (
                <tr key={it.id}>
                  <td>{it.id}</td>
                  <td>{it.expected.text}</td>
                  <td style={{ fontFamily: 'monospace' }}>{it.actual.toneSeq.join('-')}</td>
                  <td style={{ fontFamily: 'monospace', opacity: 0.7 }}>{it.expected.toneSeq.join('-')}</td>
                  <td>{hit1 ? '✓' : (it.actual.top20[0]?.text ?? '—')}</td>
                  <td>{hit5 ? '5 ✓' : hit20 ? '20 ✓' : '—'}</td>
                  <td>{it.latencyMs.toFixed(0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
