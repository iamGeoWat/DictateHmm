// Energy + F0 based segmentation: split the F0 frame stream into one-hum chunks.
//
// Heuristic: a segment is a maximal run of "voiced-ish" frames separated from
// neighbors by a short quiet/unvoiced gap. We require a minimum gap of
// ~150 ms between segments and drop segments shorter than ~80 ms.

import type { PitchFrame, Segment } from '../types';

const MIN_GAP_FRAMES = 15;   // 15 * 10ms = 150 ms minimum gap between hums
const MIN_SEG_FRAMES = 8;    // 80 ms minimum segment
const SILENCE_RMS_DB = -45;  // below this is considered silent

export function segment(frames: PitchFrame[]): Segment[] {
  if (frames.length === 0) return [];

  // Mark each frame as "active" (voiced or loud enough).
  const active: boolean[] = frames.map(
    (f) => f.f0Hz !== null && f.rmsDb > SILENCE_RMS_DB
  );

  const segments: Segment[] = [];
  let i = 0;
  while (i < frames.length) {
    // Skip inactive frames.
    while (i < frames.length && !active[i]) i++;
    if (i >= frames.length) break;
    const start = i;

    // Walk forward until we hit a long-enough inactive gap.
    let j = i + 1;
    while (j < frames.length) {
      if (active[j]) { j++; continue; }
      // Count consecutive inactive frames
      let k = j;
      while (k < frames.length && !active[k]) k++;
      const gapLen = k - j;
      if (gapLen >= MIN_GAP_FRAMES) break; // real gap
      j = k; // skip small blip, keep extending segment
    }
    const end = j; // exclusive

    if (end - start >= MIN_SEG_FRAMES) {
      const segFrames = frames.slice(start, end);
      const startMs = frames[start].timeMs;
      const endMs = frames[end - 1].timeMs + 10; // +hop ms for last frame end
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
