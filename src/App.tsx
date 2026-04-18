import { useCallback, useEffect, useRef, useState } from 'react';
import { startCapture } from './audio/capture';
import type { CaptureSession } from './audio/capture';
import { runPipeline } from './pipeline';
import type { PipelineResult, ToneIndex, ToneLabel } from './types';
import { PitchPlot } from './ui/PitchPlot';
import './App.css';

const TONE_EMOJI: Record<ToneLabel, string> = {
  1: '─', 2: '↗', 3: '∨', 4: '↘', 5: '·',
};

export default function App() {
  const [index, setIndex] = useState<ToneIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [liveRms, setLiveRms] = useState(-60);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<CaptureSession | null>(null);

  useEffect(() => {
    fetch('/data/tone-index.json')
      .then((r) => {
        if (!r.ok) throw new Error('tone-index.json not found. Run scripts/build_tone_index.py first.');
        return r.json();
      })
      .then((d: ToneIndex) => setIndex(d))
      .catch((e: Error) => setIndexError(e.message));
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setResult(null);
    try {
      const session = await startCapture();
      sessionRef.current = session;
      session.onFrame((f) => {
        const db = 20 * Math.log10(Math.max(f.rms, 1e-6));
        setLiveRms(db);
      });
      setRecording(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const stop = useCallback(async () => {
    if (!sessionRef.current || !index) return;
    const session = sessionRef.current;
    sessionRef.current = null;
    setRecording(false);
    const samples = await session.stop();
    try {
      const r = runPipeline(samples, session.sampleRate, index);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [index]);

  return (
    <div className="app">
      <header>
        <h1>DictateHmm</h1>
        <p className="subtitle">哼哼输入法 · MVP</p>
      </header>

      {indexError && (
        <div className="error">索引未加载：{indexError}</div>
      )}

      <section className="mic-section">
        <button
          className={recording ? 'mic mic-on' : 'mic'}
          disabled={!index || !!indexError}
          onClick={recording ? stop : start}
        >
          {recording ? '⏹ 停止' : '🎤 开始哼'}
        </button>
        <div className="hint">
          {!index && !indexError && '索引加载中…'}
          {index && !recording && '按钮开始；每个字之间停顿 ≥ 150 ms'}
          {recording && (
            <>
              正在录音…（点击停止）
              <div className="meter">
                <div
                  className="meter-fill"
                  style={{ width: `${Math.max(0, Math.min(100, (liveRms + 60) * 1.67))}%` }}
                />
              </div>
            </>
          )}
        </div>
      </section>

      {error && <div className="error">错误：{error}</div>}

      {result && <ResultView result={result} />}

      {index && (
        <footer>
          索引：{index.meta.totalPhrases.toLocaleString()} 词 / {index.meta.uniqueToneSeqs.toLocaleString()} 声调序列
        </footer>
      )}
    </div>
  );
}

function ResultView({ result }: { result: PipelineResult }) {
  const { segments, toneSeq, candidates, rhythm, timings } = result;

  return (
    <div className="result">
      <section className="candidates">
        <h2>候选</h2>
        {candidates.length === 0 ? (
          <div className="empty">没有候选。试试哼清楚点，或加大段间停顿。</div>
        ) : (
          <ol>
            {candidates.slice(0, 10).map((c, i) => (
              <li key={i}>
                <span className="cand-text">{c.text}</span>
                <span className="cand-pinyin">{c.pinyin}</span>
                <span className="cand-score">{c.score.toFixed(2)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="debug">
        <h2>Debug</h2>
        <div className="tone-row">
          <span className="label">检测到的声调：</span>
          {segments.length === 0 ? (
            <span>（无段）</span>
          ) : (
            segments.map((s, i) => (
              <span key={i} className="tone-chip">
                <span className="tone-big">{TONE_EMOJI[s.tone]}</span>
                <span className="tone-num">{s.tone}</span>
                <span className="tone-conf">{(s.toneConfidence * 100).toFixed(0)}%</span>
              </span>
            ))
          )}
        </div>

        <div className="tone-alts">
          <span className="label">声调序列：</span>
          <code>{toneSeq.join('-')}</code>
          {result.altToneSeqs.map((alt, i) => (
            <code key={i} className="alt-seq">{alt.join('-')}</code>
          ))}
        </div>

        <PitchPlot segments={segments} />

        <details>
          <summary>分段详情</summary>
          <table className="segs">
            <thead>
              <tr>
                <th>#</th><th>Start</th><th>End</th><th>Dur (ms)</th>
                <th>Tone</th><th>Conf</th><th>Peak dB</th><th>Slope</th><th>MinPos</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{s.startMs.toFixed(0)}</td>
                  <td>{s.endMs.toFixed(0)}</td>
                  <td>{s.durationMs.toFixed(0)}</td>
                  <td>{s.tone}</td>
                  <td>{(s.toneConfidence * 100).toFixed(0)}%</td>
                  <td>{s.energyPeakDb.toFixed(1)}</td>
                  <td>{s.features.slope.toFixed(2)}</td>
                  <td>{s.features.fMinPos.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        <details>
          <summary>节奏特征</summary>
          <div>gaps (ms): {rhythm.gaps.map((g) => g.toFixed(0)).join(', ')}</div>
          <div>durations (ms): {rhythm.durations.map((d) => d.toFixed(0)).join(', ')}</div>
          <div>word boundaries: {rhythm.wordBoundaries.map((b) => (b ? '|' : '.')).join(' ')}</div>
        </details>

        <details>
          <summary>计时</summary>
          <ul>
            {Object.entries(timings).map(([k, v]) => (
              <li key={k}>{k}: {v.toFixed(1)} ms</li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  );
}
