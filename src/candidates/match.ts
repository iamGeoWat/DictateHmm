// Candidate matching: given a tone sequence (+ Top-2 alts per position +
// rhythm word-boundary hints), generate the top-K Chinese phrase candidates
// by beam-searching over splits-into-words and looking each word up in the
// tone-index.
//
// Scoring: sum of log(freq) per word + small boost when a split aligns with
// rhythm-based word boundaries. No LM in MVP; unigram is the floor.

import type { Candidate, RhythmFeatures, ToneIndex, TonedSegment } from '../types';

const BEAM_WIDTH = 200;
const TOP_K = 20;
const MAX_WORD_LEN = 6;
const ALT_TONE_PENALTY = 0.7;      // multiplicative on freq when using 2nd-choice tone
const BOUNDARY_MATCH_BONUS = 0.8;  // additive log-units when split matches rhythm
const BOUNDARY_MISMATCH_PENALTY = -0.4;

export type MatcherOptions = {
  beamWidth?: number;
  topK?: number;
  maxCandidatesPerSeq?: number; // cap phrases considered per tone-seq lookup
};

type BeamState = {
  idx: number;        // next segment index to consume
  text: string;
  pinyin: string[];
  logScore: number;
  parts: Array<{ text: string; toneSeq: string; freq: number }>;
};

export function matchCandidates(
  toned: TonedSegment[],
  rhythm: RhythmFeatures,
  index: ToneIndex,
  opts: MatcherOptions = {}
): Candidate[] {
  const beamWidth = opts.beamWidth ?? BEAM_WIDTH;
  const topK = opts.topK ?? TOP_K;
  const maxPerSeq = opts.maxCandidatesPerSeq ?? 80;

  const n = toned.length;
  if (n === 0) return [];

  // Pre-compute the per-position tone choices (primary + top 1 alt).
  const tonePicks: Array<Array<{ tone: number; logMult: number }>> = toned.map(
    (seg) => {
      const alts = seg.altTones.slice(0, 2);
      // Primary is alts[0]; secondary (if exists and != primary) adds penalty.
      const picks: Array<{ tone: number; logMult: number }> = [
        { tone: alts[0].tone, logMult: 0 },
      ];
      if (alts[1] && alts[1].tone !== alts[0].tone) {
        picks.push({ tone: alts[1].tone, logMult: Math.log(ALT_TONE_PENALTY) });
      }
      return picks;
    }
  );

  // Beam over segment splits.
  let beam: BeamState[] = [
    { idx: 0, text: '', pinyin: [], logScore: 0, parts: [] },
  ];
  const completed: BeamState[] = [];

  while (beam.length > 0) {
    const next: BeamState[] = [];
    for (const state of beam) {
      if (state.idx >= n) {
        completed.push(state);
        continue;
      }
      // Try word lengths 1..MAX_WORD_LEN starting at idx.
      const maxL = Math.min(MAX_WORD_LEN, n - state.idx);
      for (let L = 1; L <= maxL; L++) {
        // Rhythm hint at the split: is there a word-boundary between idx+L-1 and idx+L ?
        // wordBoundaries[i] = boundary BETWEEN segment i-1 and segment i.
        // We create a split after position idx+L-1, so the boundary index is idx+L.
        let rhythmBonus = 0;
        if (state.idx + L < n) {
          const boundaryIdx = state.idx + L - 1; // wordBoundaries[boundaryIdx+1] checks between (idx+L-1)-(idx+L)
          const flag = rhythm.wordBoundaries[boundaryIdx]; // between (idx+L-1) and (idx+L): array index = idx+L-1? see computeRhythm
          // In computeRhythm we pushed for i in [1..n-1], meaning wordBoundaries[k] ↔ gap between segment k and k+1.
          // So between (idx+L-1) and (idx+L), index = idx+L-1.
          if (flag === true) rhythmBonus += BOUNDARY_MATCH_BONUS;
          else if (flag === false) rhythmBonus += BOUNDARY_MISMATCH_PENALTY;
        }

        // Enumerate tone combinations for this window.
        // For L > 3, only consider primary tones to contain explosion.
        const useAlts = L <= 3;
        const combos = useAlts
          ? enumerateTones(tonePicks, state.idx, L)
          : [primaryToneCombo(tonePicks, state.idx, L)];

        for (const combo of combos) {
          const toneKey = combo.tones.join('-');
          const bucket = index.byTone[toneKey];
          if (!bucket || bucket.length === 0) continue;

          const take = Math.min(maxPerSeq, bucket.length);
          for (let k = 0; k < take; k++) {
            const [text, freq, pinyin] = bucket[k];
            if (text.length !== L) continue; // extra safety
            const wordLog = Math.log(freq + 1);
            const newScore =
              state.logScore +
              wordLog +
              combo.logMult +
              rhythmBonus;
            next.push({
              idx: state.idx + L,
              text: state.text + text,
              pinyin: [...state.pinyin, pinyin],
              logScore: newScore,
              parts: [...state.parts, { text, toneSeq: toneKey, freq }],
            });
          }
        }
      }
    }
    // Prune the beam.
    next.sort((a, b) => b.logScore - a.logScore);
    beam = next.slice(0, beamWidth);
    if (beam.length === 0) break;
  }

  // Deduplicate completed by text, keep best score.
  const bestByText = new Map<string, BeamState>();
  for (const c of completed) {
    const prev = bestByText.get(c.text);
    if (!prev || c.logScore > prev.logScore) bestByText.set(c.text, c);
  }
  const ranked = Array.from(bestByText.values())
    .sort((a, b) => b.logScore - a.logScore)
    .slice(0, topK);

  return ranked.map((c) => ({
    text: c.text,
    pinyin: c.pinyin.join(' '),
    score: c.logScore,
    parts: c.parts,
    source: 'dict-beam' as const,
  }));
}

function enumerateTones(
  picks: Array<Array<{ tone: number; logMult: number }>>,
  start: number,
  len: number
): Array<{ tones: number[]; logMult: number }> {
  let results: Array<{ tones: number[]; logMult: number }> = [
    { tones: [], logMult: 0 },
  ];
  for (let i = 0; i < len; i++) {
    const pos = start + i;
    const posPicks = picks[pos];
    const nextResults: Array<{ tones: number[]; logMult: number }> = [];
    for (const r of results) {
      for (const p of posPicks) {
        nextResults.push({
          tones: [...r.tones, p.tone],
          logMult: r.logMult + p.logMult,
        });
      }
    }
    results = nextResults;
    // Cap to avoid explosion if someday we widen to >2 alts.
    if (results.length > 32) {
      results.sort((a, b) => b.logMult - a.logMult);
      results = results.slice(0, 32);
    }
  }
  return results;
}

function primaryToneCombo(
  picks: Array<Array<{ tone: number; logMult: number }>>,
  start: number,
  len: number
): { tones: number[]; logMult: number } {
  const tones: number[] = [];
  for (let i = 0; i < len; i++) tones.push(picks[start + i][0].tone);
  return { tones, logMult: 0 };
}
