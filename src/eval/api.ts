import type { Label, Phrase } from './types';

export async function fetchPhrases(): Promise<Phrase[]> {
  const r = await fetch('/__eval/phrases.json', { cache: 'no-store' });
  if (!r.ok) throw new Error(`phrases.json: ${r.status}`);
  return r.json();
}

export async function fetchLabels(): Promise<Label[]> {
  const r = await fetch('/__eval/labels.json', { cache: 'no-store' });
  if (!r.ok) throw new Error(`labels.json: ${r.status}`);
  return r.json();
}

export async function saveWav(filename: string, wav: Uint8Array): Promise<void> {
  const base64Wav = bytesToBase64(wav);
  const r = await fetch('/__eval/save-wav', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename, base64Wav }),
  });
  if (!r.ok) throw new Error(`save-wav: ${r.status} ${await r.text()}`);
}

export async function appendLabel(entry: Label): Promise<void> {
  const r = await fetch('/__eval/append-labels', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entry }),
  });
  if (!r.ok) throw new Error(`append-labels: ${r.status} ${await r.text()}`);
}

export async function fetchRecording(file: string): Promise<ArrayBuffer> {
  const r = await fetch(`/__eval/recordings/${encodeURIComponent(file)}`, {
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`recording ${file}: ${r.status}`);
  return r.arrayBuffer();
}

export async function saveResults(result: unknown): Promise<string> {
  const r = await fetch('/__eval/save-results', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result),
  });
  if (!r.ok) throw new Error(`save-results: ${r.status} ${await r.text()}`);
  const { filename } = await r.json();
  return filename;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
