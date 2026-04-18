export type PitchFrame = {
  timeMs: number;
  f0Hz: number | null;
  rmsDb: number;
  confidence: number;
};

export type Segment = {
  startMs: number;
  endMs: number;
  durationMs: number;
  pitch: PitchFrame[];
  energyPeakDb: number;
  energyMeanDb: number;
};

export type ToneLabel = 1 | 2 | 3 | 4 | 5;

export type ToneAlt = { tone: ToneLabel; confidence: number };

export type TonedSegment = Segment & {
  tone: ToneLabel;
  toneConfidence: number;
  altTones: ToneAlt[];
  features: {
    fStart: number;
    fEnd: number;
    fMin: number;
    fMinPos: number;
    slope: number;
    curvature: number;
    pitchRangeSemitones: number;
  };
};

export type RhythmFeatures = {
  durations: number[];
  gaps: number[];
  energyPeaks: number[];
  wordBoundaries: boolean[]; // gap-based word-break heuristic between i-1 and i
};

export type ToneIndexEntry = [string, number, string]; // [phrase, freq, pinyin]
export type ToneIndex = {
  byTone: Record<string, ToneIndexEntry[]>;
  byLen: Record<string, string[]>;
  meta: {
    totalPhrases: number;
    uniqueToneSeqs: number;
    minFreq: number;
    maxLen: number;
    topPerSeq: number;
  };
};

export type Candidate = {
  text: string;
  pinyin: string;
  score: number;
  parts: Array<{ text: string; toneSeq: string; freq: number }>;
  source: 'dict-beam';
};

export type PipelineResult = {
  segments: TonedSegment[];
  toneSeq: ToneLabel[];
  altToneSeqs: ToneLabel[][]; // alternative paths from Top-2 per segment
  rhythm: RhythmFeatures;
  candidates: Candidate[];
  timings: Record<string, number>;
};
