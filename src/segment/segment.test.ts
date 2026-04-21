import { describe, it, expect } from 'vitest';
import { computeSilenceThreshold, segment } from './segment';
import type { PitchFrame } from '../types';

function frame(timeMs: number, f0Hz: number | null, rmsDb: number): PitchFrame {
  return { timeMs, f0Hz, rmsDb, confidence: 0.9 };
}

// Build a flat run of frames of length `nFrames`, each frame 10 ms apart.
function run(startMs: number, nFrames: number, f0Hz: number | null, rmsDb: number): PitchFrame[] {
  const out: PitchFrame[] = [];
  for (let i = 0; i < nFrames; i++) out.push(frame(startMs + i * 10, f0Hz, rmsDb));
  return out;
}

describe('computeSilenceThreshold', () => {
  it('picks a midpoint between loud and quiet when there is clear dynamic range', () => {
    const frames = [
      ...run(0, 30, null, -70),   // quiet
      ...run(300, 30, 220, -40),  // loud
    ];
    const t = computeSilenceThreshold(frames);
    expect(t).toBeGreaterThan(-70);
    expect(t).toBeLessThan(-40);
    // Roughly the midpoint.
    expect(t).toBeCloseTo(-55, 0);
  });

  it('adapts downward for quiet recordings (Safari low-level case)', () => {
    const frames = [
      ...run(0, 30, null, -72),
      ...run(300, 30, 220, -55),
    ];
    const t = computeSilenceThreshold(frames);
    // Far below any hardcoded -45 dB threshold — the hum frames are active.
    expect(t).toBeLessThan(-60);
    expect(t).toBeGreaterThan(-72);
  });

  it('returns Infinity for flat signal without dynamic range', () => {
    const frames = run(0, 60, null, -70);
    expect(computeSilenceThreshold(frames)).toBe(Infinity);
  });

  it('returns Infinity when dynamic range is below 10 dB', () => {
    const frames = [
      ...run(0, 30, null, -48),
      ...run(300, 30, 220, -42),
    ];
    expect(computeSilenceThreshold(frames)).toBe(Infinity);
  });
});

describe('segment', () => {
  it('finds a single segment in a loud recording with silent head and tail', () => {
    const frames = [
      ...run(0, 30, null, -70),   // 300 ms silence
      ...run(300, 40, 220, -35),  // 400 ms hum
      ...run(700, 30, null, -70), // 300 ms silence
    ];
    const segs = segment(frames);
    expect(segs).toHaveLength(1);
    expect(segs[0].durationMs).toBeGreaterThan(300);
  });

  it('finds a single segment in a quiet (Safari-level) recording', () => {
    // This case would have returned zero segments under the old -45 dB absolute threshold.
    const frames = [
      ...run(0, 30, null, -72),
      ...run(300, 40, 220, -55),
      ...run(700, 30, null, -72),
    ];
    const segs = segment(frames);
    expect(segs).toHaveLength(1);
  });

  it('splits on gaps >= 150 ms', () => {
    const frames = [
      ...run(0, 30, null, -70),
      ...run(300, 30, 220, -40),   // hum 1 (300 ms)
      ...run(600, 20, null, -70),  // 200 ms gap
      ...run(800, 30, 220, -40),   // hum 2 (300 ms)
      ...run(1100, 30, null, -70),
    ];
    const segs = segment(frames);
    expect(segs).toHaveLength(2);
  });

  it('does not split on gaps < 150 ms (coalesces into one segment)', () => {
    const frames = [
      ...run(0, 30, null, -70),
      ...run(300, 30, 220, -40),
      ...run(600, 10, null, -70),  // only 100 ms gap
      ...run(700, 30, 220, -40),
      ...run(1000, 30, null, -70),
    ];
    const segs = segment(frames);
    expect(segs).toHaveLength(1);
  });

  it('returns zero segments on flat noise (no hum)', () => {
    const frames = run(0, 100, null, -68);
    expect(segment(frames)).toHaveLength(0);
  });

  it('drops segments shorter than 80 ms', () => {
    const frames = [
      ...run(0, 30, null, -70),
      ...run(300, 5, 220, -40),  // only 50 ms — too short
      ...run(350, 30, null, -70),
    ];
    expect(segment(frames)).toHaveLength(0);
  });
});
