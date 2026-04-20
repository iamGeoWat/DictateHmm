import type { EvalItemInput, EvalRunResult, EvalSummary } from './types';

export function aggregate(items: EvalItemInput[]): EvalRunResult {
  const n = items.length;
  const topK = { top1: 0, top5: 0, top20: 0 };
  let hits1 = 0, hits5 = 0, hits20 = 0;
  let segMismatch = 0;
  const posCorrect: number[] = [];
  const posTotal: number[] = [];
  const confusion: Record<string, number> = {};
  const byLenAcc: Record<string, { n: number; hit5: number }> = {};
  const latencies: number[] = [];

  for (const it of items) {
    const expected = it.expected.text;
    const idx = it.actual.top20.findIndex((c) => c.text === expected);
    if (idx >= 0 && idx < 1) hits1++;
    if (idx >= 0 && idx < 5) hits5++;
    if (idx >= 0 && idx < 20) hits20++;

    const len = expected.length;
    const key = String(len);
    byLenAcc[key] ??= { n: 0, hit5: 0 };
    byLenAcc[key].n++;
    if (idx >= 0 && idx < 5) byLenAcc[key].hit5++;

    const e = it.expected.toneSeq;
    const a = it.actual.toneSeq;
    if (e.length !== a.length) {
      segMismatch++;
    } else {
      for (let i = 0; i < e.length; i++) {
        while (posTotal.length <= i) { posTotal.push(0); posCorrect.push(0); }
        posTotal[i]++;
        if (e[i] === a[i]) posCorrect[i]++;
        else confusion[`${e[i]}→${a[i]}`] = (confusion[`${e[i]}→${a[i]}`] ?? 0) + 1;
      }
    }

    latencies.push(it.latencyMs);
  }

  if (n > 0) {
    topK.top1 = hits1 / n;
    topK.top5 = hits5 / n;
    topK.top20 = hits20 / n;
  }

  const toneAccuracyByPos = posTotal.map((t, i) => (t === 0 ? 0 : posCorrect[i] / t));

  const byLen: Record<string, { n: number; top5: number }> = {};
  for (const [k, v] of Object.entries(byLenAcc)) {
    byLen[k] = { n: v.n, top5: v.n === 0 ? 0 : v.hit5 / v.n };
  }

  const summary: EvalSummary = {
    n,
    topK,
    segmentCountMismatchRate: n === 0 ? 0 : segMismatch / n,
    toneAccuracyByPos,
    toneConfusion: confusion,
    byLen,
    latencyMs: quantiles(latencies),
  };

  return {
    runAt: new Date().toISOString(),
    summary,
    items,
  };
}

function quantiles(xs: number[]): { p50: number; p95: number; mean: number } {
  if (xs.length === 0) return { p50: 0, p95: 0, mean: 0 };
  const sorted = [...xs].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return { p50: p(0.5), p95: p(0.95), mean };
}
