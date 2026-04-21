import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { startCapture } from '../../audio/capture';
import type { CaptureSession } from '../../audio/capture';
import { encodeWav } from '../wav';
import { appendLabel, fetchLabels, fetchPhrases, saveWav } from '../api';
import type { Label, Phrase } from '../types';

type RecState =
  | { kind: 'idle' }
  | { kind: 'recording'; session: CaptureSession }
  | { kind: 'reviewing'; wav: Uint8Array; url: string };

const MAX_RECORD_MS = 5000;

export function EvalRecord() {
  const [phrases, setPhrases] = useState<Phrase[] | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [rec, setRec] = useState<RecState>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const autoStopRef = useRef<number | null>(null);
  const recRef = useRef<RecState>(rec);
  recRef.current = rec;

  const reload = useCallback(async () => {
    try {
      const [p, l] = await Promise.all([fetchPhrases(), fetchLabels()]);
      setPhrases(p);
      setLabels(l);
      setSelectedId((cur) => cur ?? (p[0]?.id ?? null));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const countById = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of labels) m.set(l.id, (m.get(l.id) ?? 0) + 1);
    return m;
  }, [labels]);

  const sorted = useMemo(() => {
    if (!phrases) return [];
    return [...phrases].sort((a, b) => {
      const ca = countById.get(a.id) ?? 0;
      const cb = countById.get(b.id) ?? 0;
      if (ca !== cb) return ca - cb;
      return a.id.localeCompare(b.id);
    });
  }, [phrases, countById]);

  const selected = phrases?.find((p) => p.id === selectedId) ?? null;

  const stop = useCallback(async () => {
    if (autoStopRef.current !== null) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    const cur = recRef.current;
    if (cur.kind !== 'recording') return;
    try {
      const samples = await cur.session.stop();
      const wav = encodeWav(samples, cur.session.sampleRate);
      const blob = new Blob([wav as BlobPart], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setRec({ kind: 'reviewing', wav, url });
    } catch (e) {
      setError((e as Error).message);
      setRec({ kind: 'idle' });
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const session = await startCapture();
      setRec({ kind: 'recording', session });
      autoStopRef.current = window.setTimeout(() => { void stop(); }, MAX_RECORD_MS);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [stop]);

  const retake = useCallback(() => {
    setRec((cur) => {
      if (cur.kind === 'reviewing') URL.revokeObjectURL(cur.url);
      return { kind: 'idle' };
    });
  }, []);

  const save = useCallback(async () => {
    const cur = recRef.current;
    if (cur.kind !== 'reviewing' || !selected) return;
    const now = new Date();
    const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
    const hhmm = now.toISOString().slice(11, 16).replace(':', '');
    const seq = String((countById.get(selected.id) ?? 0) + 1).padStart(2, '0');
    const filename = `${selected.id}_${yyyymmdd}_${hhmm}_${seq}.wav`;
    try {
      await saveWav(filename, cur.wav);
      const entry: Label = {
        id: selected.id,
        file: filename,
        recordedAt: now.toISOString(),
      };
      if (note.trim()) entry.note = note.trim();
      await appendLabel(entry);
      URL.revokeObjectURL(cur.url);
      setRec({ kind: 'idle' });
      setNote('');
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selected, note, countById, reload]);

  if (!phrases) {
    return (
      <div className="app">
        <header><h1>Eval · 录制</h1></header>
        <p style={{ padding: 24 }}>{error ? `错误: ${error}` : '加载中…'}</p>
      </div>
    );
  }

  return (
    <div className="app" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <h1>Eval · 录制</h1>
        <Link to="/eval">← eval 首页</Link>
        <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
          {labels.length} 条录音 / {phrases.length} 条脚本（
          {sorted.filter((p) => (countById.get(p.id) ?? 0) > 0).length} 条已录）
        </span>
      </header>

      {error && <div className="error">错误：{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24, padding: 16 }}>
        <aside style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <h3>脚本</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {sorted.map((p) => {
              const c = countById.get(p.id) ?? 0;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => setSelectedId(p.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 8px',
                      background: p.id === selectedId ? '#334' : 'transparent',
                      color: 'inherit',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ opacity: 0.5 }}>{p.id}</span> · {p.text}
                    <span style={{ float: 'right', opacity: 0.7 }}>×{c}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main>
          {selected && (
            <section>
              <div style={{ fontSize: 48, fontWeight: 700, marginBottom: 8 }}>{selected.text}</div>
              <div style={{ opacity: 0.7, marginBottom: 4 }}>{selected.pinyin}</div>
              <div style={{ opacity: 0.5, fontFamily: 'monospace', marginBottom: 24 }}>
                tone: {selected.toneSeq.join('-')}
              </div>

              {rec.kind === 'idle' && (
                <button className="mic" onClick={start}>🎤 录</button>
              )}
              {rec.kind === 'recording' && (
                <button className="mic mic-on" onClick={stop}>⏹ 停（自动 5s）</button>
              )}
              {rec.kind === 'reviewing' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
                  <audio src={rec.url} controls />
                  <input
                    placeholder="note（可选，例如 quiet / keyboard / tired）"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={save}>💾 保存</button>
                    <button onClick={retake}>🔁 重录</button>
                  </div>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
