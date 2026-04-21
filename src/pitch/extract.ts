// Frame-level F0 extraction via pitchy (McLeod Pitch Method) + smoothing.

import { PitchDetector } from 'pitchy';
import type { PitchFrame } from '../types';

const FRAME_SIZE = 2048; // pitchy's internal sizing is FFT-based; keep a power of two
const HOP_SIZE = 160;    // 10 ms at 16 kHz
const MIN_F0 = 60;
const MAX_F0 = 500;
const MIN_CLARITY = 0.6;

export function extractF0(samples: Float32Array, sampleRate: number): PitchFrame[] {
  if (sampleRate !== 16000) {
    throw new Error(`extractF0 expects 16 kHz input, got ${sampleRate}`);
  }
  const detector = PitchDetector.forFloat32Array(FRAME_SIZE);
  // Keep this low so quiet recordings (e.g. Safari without effective AGC)
  // still yield F0 frames. Bogus pitch on noise is filtered by MIN_CLARITY
  // and by segmentation's adaptive silence threshold.
  detector.minVolumeDecibels = -70;

  const out: PitchFrame[] = [];
  const frame = new Float32Array(FRAME_SIZE);

  for (let start = 0; start + FRAME_SIZE <= samples.length; start += HOP_SIZE) {
    frame.set(samples.subarray(start, start + FRAME_SIZE));

    // Simple RMS for the frame
    let sumSq = 0;
    for (let j = 0; j < FRAME_SIZE; j++) sumSq += frame[j] * frame[j];
    const rms = Math.sqrt(sumSq / FRAME_SIZE);
    const rmsDb = 20 * Math.log10(Math.max(rms, 1e-8));

    const [hz, clarity] = detector.findPitch(frame, sampleRate);

    let f0: number | null = null;
    if (hz >= MIN_F0 && hz <= MAX_F0 && clarity >= MIN_CLARITY && rmsDb > -65) {
      f0 = hz;
    }

    out.push({
      timeMs: (start / sampleRate) * 1000,
      f0Hz: f0,
      confidence: clarity,
      rmsDb,
    });
  }

  return smoothAndCleanup(out);
}

// Median filter over a 5-frame window (on voiced frames only) + octave-error fix.
function smoothAndCleanup(frames: PitchFrame[]): PitchFrame[] {
  const out = frames.map((f) => ({ ...f }));
  const W = 2;

  // Fix octave errors first (one frame 2x or 0.5x its neighbors).
  for (let i = 1; i < out.length - 1; i++) {
    const prev = out[i - 1].f0Hz;
    const curr = out[i].f0Hz;
    const next = out[i + 1].f0Hz;
    if (prev && curr && next) {
      const ratioUp = curr / ((prev + next) / 2);
      if (ratioUp > 1.7 && ratioUp < 2.3) out[i].f0Hz = curr / 2;
      else if (ratioUp > 0.43 && ratioUp < 0.59) out[i].f0Hz = curr * 2;
    }
  }

  // Median filter
  for (let i = 0; i < out.length; i++) {
    const vals: number[] = [];
    for (let j = Math.max(0, i - W); j <= Math.min(out.length - 1, i + W); j++) {
      const v = out[j].f0Hz;
      if (v != null) vals.push(v);
    }
    if (vals.length >= 3) {
      vals.sort((a, b) => a - b);
      out[i].f0Hz = vals[Math.floor(vals.length / 2)];
    }
  }

  return out;
}
