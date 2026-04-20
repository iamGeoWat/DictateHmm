import { describe, it, expect } from 'vitest';
import { aggregate } from './metrics';
import type { EvalItemInput } from './types';
import type { ToneLabel } from '../types';

function item(
  id: string,
  text: string,
  expectedToneSeq: number[],
  actualToneSeq: number[],
  top20Texts: string[],
  latencyMs = 100,
): EvalItemInput {
  return {
    id,
    file: `${id}.wav`,
    expected: { text, toneSeq: expectedToneSeq as ToneLabel[] },
    actual: {
      toneSeq: actualToneSeq as ToneLabel[],
      toneSeqAlt: [],
      top20: top20Texts.map((t, i) => ({ text: t, pinyin: '', score: -i })),
    },
    latencyMs,
  };
}

describe('aggregate', () => {
  it('computes Top-K hit rates based on expected.text position in top20', () => {
    const items: EvalItemInput[] = [
      item('a', '你好', [3, 3], [3, 3], ['你好', 'x', 'y']),
      item('b', '谢谢', [4, 4], [4, 4], ['x', 'y', 'z', 'w', '谢谢']),
      item('c', '晚安', [3, 1], [3, 1], ['a', 'b', 'c', 'd', 'e', 'f',
        'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', '晚安']),
      item('d', '再见', [4, 4], [4, 4], ['x']),
    ];
    const s = aggregate(items).summary;
    expect(s.n).toBe(4);
    expect(s.topK.top1).toBeCloseTo(1 / 4);
    expect(s.topK.top5).toBeCloseTo(2 / 4);
    expect(s.topK.top20).toBeCloseTo(3 / 4);
  });

  it('computes tone accuracy only when segment count matches', () => {
    const items: EvalItemInput[] = [
      item('a', '你好', [3, 3], [3, 3], []),
      item('b', '谢谢', [4, 4], [4, 2], []),
      item('c', '晚安', [3, 1], [3, 1, 1], []),
    ];
    const s = aggregate(items).summary;
    expect(s.segmentCountMismatchRate).toBeCloseTo(1 / 3);
    expect(s.toneAccuracyByPos[0]).toBeCloseTo(1);
    expect(s.toneAccuracyByPos[1]).toBeCloseTo(1 / 2);
  });

  it('builds confusion matrix on aligned pairs', () => {
    const items: EvalItemInput[] = [
      item('a', '你好', [3, 3], [3, 2], []),
      item('b', '谢谢', [4, 4], [1, 4], []),
      item('c', '晚安', [3, 1], [3, 1], []),
    ];
    const s = aggregate(items).summary;
    expect(s.toneConfusion['3→2']).toBe(1);
    expect(s.toneConfusion['4→1']).toBe(1);
    expect(Object.keys(s.toneConfusion).length).toBe(2);
  });

  it('groups Top-5 hit rate by expected text length', () => {
    const items: EvalItemInput[] = [
      item('a', '你好', [3, 3], [3, 3], ['你好']),
      item('b', '谢谢', [4, 4], [4, 4], ['x']),
      item('c', '晚上好', [3, 4, 3], [3, 4, 3], ['晚上好']),
    ];
    const s = aggregate(items).summary;
    expect(s.byLen['2'].n).toBe(2);
    expect(s.byLen['2'].top5).toBeCloseTo(1 / 2);
    expect(s.byLen['3'].n).toBe(1);
    expect(s.byLen['3'].top5).toBe(1);
  });

  it('computes p50/p95/mean latency', () => {
    const items: EvalItemInput[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100].map((ms, i) =>
      item(`x${i}`, 'x', [1], [1], [], ms),
    );
    const s = aggregate(items).summary;
    expect(s.latencyMs.p50).toBe(6);
    expect(s.latencyMs.p95).toBe(100);
    expect(s.latencyMs.mean).toBeCloseTo((1+2+3+4+5+6+7+8+9+100)/10);
  });

  it('returns empty-safe summary for zero items', () => {
    const r = aggregate([]);
    expect(r.summary.n).toBe(0);
    expect(r.summary.topK.top1).toBe(0);
    expect(r.summary.toneAccuracyByPos).toEqual([]);
    expect(r.summary.toneConfusion).toEqual({});
    expect(r.summary.byLen).toEqual({});
  });
});
