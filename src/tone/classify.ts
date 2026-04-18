// Rule-based Mandarin tone classifier on a single segment's F0 contour.
//
// Features (after log2 + z-score normalization within the segment):
//   fStart, fEnd, fMin, fMinPos (0..1), slope, curvature, duration
//
// Rules (approximate, tuned for hummed tones; Top-2 always returned):
//   Tone 1 (high flat):   |slope| small, fStart/fEnd both high-ish
//   Tone 2 (rising):      slope strongly positive
//   Tone 3 (dip or low):  fMinPos between 0.2 and 0.8 AND fMin << endpoints
//                         OR: fStart low and |slope| small (half-third tone)
//   Tone 4 (falling):     slope strongly negative
//   Tone 5 (neutral):     very short duration AND low energy relative to peers
//                         (handled at the pipeline layer, not here)

import type { Segment, TonedSegment, ToneAlt, ToneLabel } from '../types';

export function classifySegmentTone(seg: Segment): TonedSegment {
  const voiced = seg.pitch.filter((p) => p.f0Hz !== null);
  if (voiced.length < 3) {
    // too few voiced frames — default to 1 with low confidence
    return {
      ...seg,
      tone: 1,
      toneConfidence: 0.1,
      altTones: [{ tone: 1, confidence: 0.1 }],
      features: {
        fStart: 0, fEnd: 0, fMin: 0, fMinPos: 0.5,
        slope: 0, curvature: 0, pitchRangeSemitones: 0,
      },
    };
  }

  const f0s = voiced.map((p) => Math.log2(p.f0Hz as number));
  const mean = avg(f0s);
  const std = stddev(f0s, mean) || 1;
  const z = f0s.map((v) => (v - mean) / std);
  const n = z.length;

  const headN = Math.max(1, Math.floor(n * 0.2));
  const tailN = Math.max(1, Math.floor(n * 0.2));
  const fStart = median(z.slice(0, headN));
  const fEnd = median(z.slice(n - tailN));

  let fMin = Infinity, fMinIdx = 0, fMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (z[i] < fMin) { fMin = z[i]; fMinIdx = i; }
    if (z[i] > fMax) fMax = z[i];
  }
  const fMinPos = fMinIdx / Math.max(1, n - 1);

  const slope = fEnd - fStart; // already normalized
  const curvature = fitCurvature(z);

  // Range in semitones (12 per octave, since z is in log2-Hz)
  const pitchRangeSemitones = (fMax - fMin) * 12 * std;

  // Compute scores for each tone.
  const scores: Record<ToneLabel, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  // Tone 1: flat and not-low. |slope| small, curvature small, mean level moderate-to-high.
  scores[1] = gauss(slope, 0, 0.6) * gauss(curvature, 0, 1.0);

  // Tone 2: rising. slope positive and sizeable.
  scores[2] = sigmoid(slope - 0.5, 3.0);

  // Tone 4: falling. slope negative and sizeable.
  scores[4] = sigmoid(-slope - 0.5, 3.0);

  // Tone 3: V-shape or low dip. fMin significantly below endpoints, fMinPos in mid.
  const dipDepth = Math.max(0, Math.min(fStart, fEnd) - fMin);
  const dipInMid = fMinPos > 0.15 && fMinPos < 0.85 ? 1 : 0.2;
  const thirdDip = Math.min(1, dipDepth / 0.8) * dipInMid;
  // Half-third: low and flat-ish (slope near 0, mean low, stays low)
  const halfThird = Math.max(0, -fStart) > 0.3 && Math.abs(slope) < 0.5 ? 0.6 : 0;
  scores[3] = Math.max(thirdDip, halfThird);

  // Tone 5 (neutral): handled at pipeline layer (needs context); give a small flat score.
  scores[5] = seg.durationMs < 150 ? 0.3 : 0.05;

  // Normalize into [0, 1] confidences.
  const entries: Array<[ToneLabel, number]> = (Object.keys(scores) as unknown as string[])
    .map((k) => [Number(k) as ToneLabel, scores[Number(k) as ToneLabel]]);
  entries.sort((a, b) => b[1] - a[1]);
  const sum = entries.reduce((s, [, v]) => s + v, 0) || 1;
  const normalized: ToneAlt[] = entries.map(([tone, v]) => ({ tone, confidence: v / sum }));

  return {
    ...seg,
    tone: normalized[0].tone,
    toneConfidence: normalized[0].confidence,
    altTones: normalized.slice(0, 3),
    features: {
      fStart, fEnd, fMin, fMinPos, slope, curvature, pitchRangeSemitones,
    },
  };
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
}

function stddev(xs: number[], m: number): number {
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, xs.length);
  return Math.sqrt(v);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Fit y = a*t^2 + b*t + c over t in [0..1]; return a (2nd-order coeff).
function fitCurvature(y: number[]): number {
  const n = y.length;
  if (n < 3) return 0;
  let Sx = 0, Sx2 = 0, Sx3 = 0, Sx4 = 0, Sy = 0, Sxy = 0, Sx2y = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const t2 = t * t;
    Sx += t; Sx2 += t2; Sx3 += t2 * t; Sx4 += t2 * t2;
    Sy += y[i]; Sxy += t * y[i]; Sx2y += t2 * y[i];
  }
  // Solve 3x3 normal eq for [a, b, c]
  // Using cramer's / simple inverse; acceptable for n<=~500.
  const m = [
    [Sx4, Sx3, Sx2],
    [Sx3, Sx2, Sx],
    [Sx2, Sx, n],
  ];
  const v = [Sx2y, Sxy, Sy];
  const det = det3(m);
  if (Math.abs(det) < 1e-9) return 0;
  const a = det3([
    [v[0], m[0][1], m[0][2]],
    [v[1], m[1][1], m[1][2]],
    [v[2], m[2][1], m[2][2]],
  ]) / det;
  return a;
}

function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function gauss(x: number, mu: number, sigma: number): number {
  const d = (x - mu) / sigma;
  return Math.exp(-0.5 * d * d);
}

function sigmoid(x: number, k: number): number {
  return 1 / (1 + Math.exp(-k * x));
}
