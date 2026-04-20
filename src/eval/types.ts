import type { Candidate, ToneLabel } from '../types';

export type Phrase = {
  id: string;
  text: string;
  pinyin: string;
  toneSeq: ToneLabel[];
  source: 'script' | 'freeform';
  pendingCompile?: boolean;
};

export type Label = {
  id: string;
  file: string;
  recordedAt: string;
  note?: string;
};

export type EvalItemInput = {
  id: string;
  file: string;
  expected: { text: string; toneSeq: ToneLabel[] };
  actual: {
    toneSeq: ToneLabel[];
    toneSeqAlt: ToneLabel[][];
    top20: Array<Pick<Candidate, 'text' | 'pinyin' | 'score'>>;
  };
  latencyMs: number;
};

export type EvalSummary = {
  n: number;
  topK: { top1: number; top5: number; top20: number };
  segmentCountMismatchRate: number;
  toneAccuracyByPos: number[];
  toneConfusion: Record<string, number>;
  byLen: Record<string, { n: number; top5: number }>;
  latencyMs: { p50: number; p95: number; mean: number };
};

export type EvalRunResult = {
  runAt: string;
  gitSha?: string;
  indexMeta?: { totalPhrases: number; uniqueToneSeqs: number };
  summary: EvalSummary;
  items: EvalItemInput[];
};
