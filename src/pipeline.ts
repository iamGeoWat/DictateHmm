// Orchestrates the full pipeline: audio samples -> candidates.

import { resampleTo16k } from './audio/capture';
import { extractF0 } from './pitch/extract';
import { segment } from './segment/segment';
import { classifySegmentTone } from './tone/classify';
import { computeRhythm } from './rhythm/features';
import { matchCandidates } from './candidates/match';
import type { PipelineResult, ToneIndex, ToneLabel } from './types';

export function runPipeline(
  samples: Float32Array,
  sampleRate: number,
  index: ToneIndex
): PipelineResult {
  const timings: Record<string, number> = {};

  let t0 = performance.now();
  const pcm16k = resampleTo16k(samples, sampleRate);
  timings.resample = performance.now() - t0;

  t0 = performance.now();
  const frames = extractF0(pcm16k, 16000);
  timings.f0 = performance.now() - t0;

  t0 = performance.now();
  const segs = segment(frames);
  timings.segment = performance.now() - t0;

  t0 = performance.now();
  const toned = segs.map(classifySegmentTone);
  timings.tone = performance.now() - t0;

  t0 = performance.now();
  const rhythm = computeRhythm(segs);
  timings.rhythm = performance.now() - t0;

  t0 = performance.now();
  const candidates = matchCandidates(toned, rhythm, index);
  timings.candidates = performance.now() - t0;

  const toneSeq = toned.map((s) => s.tone) as ToneLabel[];
  const altToneSeqs: ToneLabel[][] = [];
  // Build the 2nd-choice tone sequence (one position at a time)
  if (toned.length > 0) {
    for (let pos = 0; pos < toned.length; pos++) {
      const alts = toned[pos].altTones;
      if (alts.length < 2 || alts[1].tone === alts[0].tone) continue;
      const alt = toneSeq.slice();
      alt[pos] = alts[1].tone;
      altToneSeqs.push(alt);
    }
  }

  return {
    segments: toned,
    toneSeq,
    altToneSeqs,
    rhythm,
    candidates,
    timings,
  };
}
