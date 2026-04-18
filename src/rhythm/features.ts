// Derive rhythm features from the segment list. Used as a soft prior for
// word segmentation inside the candidate matcher.

import type { RhythmFeatures, Segment } from '../types';

const WORD_GAP_MS = 250; // gap >= this is likely a word boundary
const WORD_INSIDE_MS = 130; // gap <= this is likely inside a word

export function computeRhythm(segments: Segment[]): RhythmFeatures {
  const durations = segments.map((s) => s.durationMs);
  const peaks = segments.map((s) => s.energyPeakDb);
  const gaps: number[] = [];
  const wordBoundaries: boolean[] = [];
  for (let i = 1; i < segments.length; i++) {
    const g = segments[i].startMs - segments[i - 1].endMs;
    gaps.push(g);
    // true = likely a word boundary between segment i-1 and i
    wordBoundaries.push(g >= (WORD_GAP_MS + WORD_INSIDE_MS) / 2);
  }
  return { durations, gaps, energyPeaks: peaks, wordBoundaries };
}
