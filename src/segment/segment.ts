// Energy + F0 based segmentation: split the F0 frame stream into one-hum chunks.
//
// Heuristic: a segment is a maximal run of "voiced-ish" frames separated from
// neighbors by a short quiet/unvoiced gap. We require a minimum gap of
// ~150 ms between segments and drop segments shorter than ~80 ms.
//
// Silence threshold is computed **per-recording** from the RMS distribution
// (bimodal split: halfway between the 20-percentile-loudest and 20-percentile-
// quietest frames). This makes segmentation independent of absolute mic
// loudness — a quiet Safari recording and a loud Chrome recording both work
// as long as there's a clear voice-vs-gap dynamic range.

import type { PitchFrame, Segment } from '../types';

const MIN_GAP_FRAMES = 15;   // 15 * 10ms = 150 ms minimum gap between hums
const MIN_SEG_FRAMES = 8;    // 80 ms minimum segment
const MIN_DYNAMIC_RANGE_DB = 10; // below this, treat recording as flat (no segments)

export function segment(frames: PitchFrame[]): Segment[] {
  if (frames.length === 0) return [];

  const threshold = computeSilenceThreshold(frames);

  // Mark each frame as "active" (voiced or loud enough).
  const active: boolean[] = frames.map(
    (f) => f.f0Hz !== null && f.rmsDb > threshold
  );

  const segments: Segment[] = [];
  let i = 0;
  while (i < frames.length) {
    while (i < frames.length && !active[i]) i++;
    if (i >= frames.length) break;
    const start = i;

    let j = i + 1;
    while (j < frames.length) {
      if (active[j]) { j++; continue; }
      let k = j;
      while (k < frames.length && !active[k]) k++;
      const gapLen = k - j;
      if (gapLen >= MIN_GAP_FRAMES) break;
      j = k;
    }
    const end = j;

    if (end - start >= MIN_SEG_FRAMES) {
      const segFrames = frames.slice(start, end);
      const startMs = frames[start].timeMs;
      const endMs = frames[end - 1].timeMs + 10;
      let peakDb = -Infinity, sumDb = 0, countDb = 0;
      for (const fr of segFrames) {
        if (fr.rmsDb > peakDb) peakDb = fr.rmsDb;
        sumDb += fr.rmsDb; countDb++;
      }
      segments.push({
        startMs,
        endMs,
        durationMs: endMs - startMs,
        pitch: segFrames,
        energyPeakDb: peakDb,
        energyMeanDb: sumDb / Math.max(1, countDb),
      });
    }
    i = end;
  }

  return segments;
}

// Exported for testing and for the debug UI ("what threshold did we use?").
export function computeSilenceThreshold(frames: PitchFrame[]): number {
  if (frames.length === 0) return Infinity;
  const sorted = frames.map((f) => f.rmsDb).sort((a, b) => a - b);
  const n = sorted.length;
  const quietCount = Math.max(1, Math.floor(n * 0.2));
  const quietMean = mean(sorted.slice(0, quietCount));
  const loudMean = mean(sorted.slice(n - quietCount));
  if (loudMean - quietMean < MIN_DYNAMIC_RANGE_DB) return Infinity;
  return (quietMean + loudMean) / 2;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
