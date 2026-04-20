# Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零搭起 DictateHmm 的评测工具：浏览器里能按引导录音，能批量跑 pipeline 看指标，录音和结果都通过 Vite dev 插件落盘。

**Architecture:** 两条新路由 `/eval/record`、`/eval/run`，采集严格复用 `src/audio/capture.ts` + `src/pipeline.ts`。写盘走 Vite dev 插件暴露的 `/__eval/*` 端点（生产 build 不包含）。phrase 脚本用 Python 的 pypinyin 编译成 `phrases.json`，和 `build_tone_index.py` 同一套标注口径。

**Tech Stack:** TypeScript + React 19 + Vite 8 / Vitest / react-router-dom / Python + pypinyin（脚本端）/ Node 的 `fs/promises`（插件端）。

**Spec:** `docs/superpowers/specs/2026-04-19-eval-harness-design.md`

---

## 文件布局

新建：
- `scripts/vite-plugin-eval-io.ts` — dev-only Vite 插件，3 个 POST + 2 个 GET 端点
- `scripts/build_phrases.py` — phrases.txt → phrases.json 编译脚本
- `eval/datasets/phrases.txt` — phrase 脚本源头（人维护）
- `eval/datasets/phrases.json` — 构建产物（commit，方便复现）
- `eval/datasets/recordings/.gitkeep` — 录音目录
- `eval/results/.gitkeep` — 结果目录
- `eval/README.md` — 工作流三步走
- `src/eval/wav.ts` — Float32 → 16-bit PCM WAV 编码器
- `src/eval/wav.test.ts`
- `src/eval/metrics.ts` — 指标聚合纯函数
- `src/eval/metrics.test.ts`
- `src/eval/types.ts` — 评测侧数据类型（phrase、label、result）
- `src/eval/api.ts` — 薄客户端包装 `/__eval/*` 端点
- `src/eval/pages/EvalIndex.tsx`
- `src/eval/pages/EvalRecord.tsx`
- `src/eval/pages/EvalRun.tsx`
- `vitest.config.ts`

修改：
- `package.json` — 加 `vitest`、`react-router-dom` 依赖和 `test`、`build:phrases` 脚本
- `vite.config.ts` — 挂插件
- `tsconfig.node.json` — include 加 `scripts/vite-plugin-eval-io.ts` 和 `vitest.config.ts`
- `src/main.tsx` — 换成 router 入口
- `src/App.tsx` — 导出"主页面"组件，不再是根组件
- `.gitignore` — 跳过 `eval/results/*.json`（但保留 .gitkeep）

---

## Task 1: 装依赖 + 测试框架

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Modify: `tsconfig.node.json`

- [ ] **Step 1: 装 runtime / test 依赖**

```bash
npm install react-router-dom
npm install -D vitest
```

Expected: `npm ls react-router-dom vitest` 能看见两个包装上。

- [ ] **Step 2: 加 npm scripts**

在 `package.json` 的 `scripts` 里加两行（`test` 和 `build:phrases`）：

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "build:phrases": "python3 scripts/build_phrases.py"
}
```

- [ ] **Step 3: 写 `vitest.config.ts`**

在仓库根：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: 让 tsc 认识新文件**

改 `tsconfig.node.json` 的 `include`：

```json
"include": ["vite.config.ts", "vitest.config.ts", "scripts/vite-plugin-eval-io.ts"]
```

- [ ] **Step 5: 验证**

```bash
npx vitest run --passWithNoTests
npm run build
```

Expected: vitest 零测试通过、`npm run build`（也就是 `tsc -b && vite build`）通过没有报错。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tsconfig.node.json
git commit -m "chore(eval): add vitest + react-router-dom for eval harness

评测工具需要路由 (/eval/record, /eval/run) 和 TDD 工具链。vitest 用于
纯函数单测（WAV 编码、指标聚合），UI 页面手动验证。"
```

---

## Task 2: WAV 编码器（TDD）

**Files:**
- Create: `src/eval/wav.ts`
- Create: `src/eval/wav.test.ts`

背景：浏览器 `AudioBuffer` 输出 Float32，但 WAV 文件通常是 16-bit PCM。这个编码器
拿 `Float32Array` + 采样率，产出合法 WAV 的 `Uint8Array`，能被 `AudioContext.decodeAudioData`
反向读回来。

- [ ] **Step 1: 写失败测试**

`src/eval/wav.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { encodeWav } from './wav';

describe('encodeWav', () => {
  it('writes a valid RIFF/WAVE header for mono 16-bit PCM', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const wav = encodeWav(samples, 16000);

    const td = new TextDecoder('ascii');
    expect(td.decode(wav.slice(0, 4))).toBe('RIFF');
    expect(td.decode(wav.slice(8, 12))).toBe('WAVE');
    expect(td.decode(wav.slice(12, 16))).toBe('fmt ');

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    // fmt chunk size = 16
    expect(view.getUint32(16, true)).toBe(16);
    // audioFormat = 1 (PCM)
    expect(view.getUint16(20, true)).toBe(1);
    // numChannels = 1
    expect(view.getUint16(22, true)).toBe(1);
    // sampleRate = 16000
    expect(view.getUint32(24, true)).toBe(16000);
    // bitsPerSample = 16
    expect(view.getUint16(34, true)).toBe(16);
    // data chunk id
    expect(td.decode(wav.slice(36, 40))).toBe('data');
    // data chunk size = samples * 2 bytes
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it('round-trips samples within 16-bit quantization error', () => {
    const samples = new Float32Array(100);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 0.1) * 0.8;
    const wav = encodeWav(samples, 16000);

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    // Data starts at offset 44 (standard PCM WAV header)
    for (let i = 0; i < samples.length; i++) {
      const int16 = view.getInt16(44 + i * 2, true);
      const decoded = int16 / 32768;
      expect(Math.abs(decoded - samples[i])).toBeLessThan(1 / 32768 + 1e-6);
    }
  });

  it('clips samples outside [-1, 1]', () => {
    const samples = new Float32Array([2, -2, 1.5, -1.5]);
    const wav = encodeWav(samples, 16000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getInt16(44, true)).toBe(32767);       // +2 → max
    expect(view.getInt16(44 + 2, true)).toBe(-32768);  // -2 → min
    expect(view.getInt16(44 + 4, true)).toBe(32767);   // +1.5 → max
    expect(view.getInt16(44 + 6, true)).toBe(-32768);  // -1.5 → min
  });
});
```

- [ ] **Step 2: 确认测试失败**

```bash
npm test
```

Expected: 3 tests 全 FAIL（`encodeWav` 不存在）。

- [ ] **Step 3: 实现**

`src/eval/wav.ts`：

```ts
// Encode mono Float32 samples as a 16-bit PCM WAV file byte stream.
// Samples outside [-1, 1] are clipped.

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * 2;
  const fileSize = 44 + dataSize;

  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);

  // RIFF header
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeAscii(view, 8, 'WAVE');

  // fmt chunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);              // chunk size
  view.setUint16(20, 1, true);               // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // samples
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const int16 = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, int16)), true);
  }

  return new Uint8Array(buf);
}

function writeAscii(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}
```

- [ ] **Step 4: 确认测试通过**

```bash
npm test
```

Expected: 3 tests PASS。

- [ ] **Step 5: Commit**

```bash
git add src/eval/wav.ts src/eval/wav.test.ts
git commit -m "feat(eval): WAV encoder for Float32 mono samples

浏览器录音拿到的是 Float32Array，需要编码成 16-bit PCM WAV 落盘。
写成独立纯函数方便单测（RIFF 头合法性 + 16-bit 量化误差 + clip 边界）。"
```

---

## Task 3: 指标聚合（TDD）

**Files:**
- Create: `src/eval/types.ts`
- Create: `src/eval/metrics.ts`
- Create: `src/eval/metrics.test.ts`

背景：`/eval/run` 拿到每条样本的 `{ expected, actual, latencyMs }` 后，要聚合
成 summary + 混淆矩阵 + 按字数拆。这部分是纯函数，TDD 成本最低。

- [ ] **Step 1: 定义数据类型**

`src/eval/types.ts`：

```ts
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
  recordedAt: string; // ISO
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
  toneAccuracyByPos: number[];           // length = max expected len
  toneConfusion: Record<string, number>; // "expected→actual", e.g. "2→3"
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
```

- [ ] **Step 2: 写失败测试**

`src/eval/metrics.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { aggregate } from './metrics';
import type { EvalItemInput } from './types';

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
    expected: { text, toneSeq: expectedToneSeq as any },
    actual: {
      toneSeq: actualToneSeq as any,
      toneSeqAlt: [],
      top20: top20Texts.map((t, i) => ({ text: t, pinyin: '', score: -i })),
    },
    latencyMs,
  };
}

describe('aggregate', () => {
  it('computes Top-K hit rates based on expected.text position in top20', () => {
    const items: EvalItemInput[] = [
      item('a', '你好', [3, 3], [3, 3], ['你好', 'x', 'y']),              // top1 hit
      item('b', '谢谢', [4, 4], [4, 4], ['x', 'y', 'z', 'w', '谢谢']),     // top5 hit, not top1
      item('c', '晚安', [3, 1], [3, 1], ['a', 'b', 'c', 'd', 'e', 'f',
        'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', '晚安']), // top20 hit
      item('d', '再见', [4, 4], [4, 4], ['x']),                           // miss
    ];
    const s = aggregate(items).summary;
    expect(s.n).toBe(4);
    expect(s.topK.top1).toBeCloseTo(1 / 4);
    expect(s.topK.top5).toBeCloseTo(2 / 4);
    expect(s.topK.top20).toBeCloseTo(3 / 4);
  });

  it('computes tone accuracy only when segment count matches', () => {
    const items: EvalItemInput[] = [
      item('a', '你好', [3, 3], [3, 3], []),   // both correct
      item('b', '谢谢', [4, 4], [4, 2], []),   // pos 1 wrong
      item('c', '晚安', [3, 1], [3, 1, 1], []),  // segment count mismatch -> excluded
    ];
    const s = aggregate(items).summary;
    expect(s.segmentCountMismatchRate).toBeCloseTo(1 / 3);
    // position 0 correct in a,b (2/2); position 1 correct only in a (1/2)
    expect(s.toneAccuracyByPos[0]).toBeCloseTo(1);
    expect(s.toneAccuracyByPos[1]).toBeCloseTo(1 / 2);
  });

  it('builds confusion matrix on aligned pairs', () => {
    const items: EvalItemInput[] = [
      item('a', '你好', [3, 3], [3, 2], []),   // 3→2 at pos 1
      item('b', '谢谢', [4, 4], [1, 4], []),   // 4→1 at pos 0
      item('c', '晚安', [3, 1], [3, 1], []),   // no errors
    ];
    const s = aggregate(items).summary;
    expect(s.toneConfusion['3→2']).toBe(1);
    expect(s.toneConfusion['4→1']).toBe(1);
    expect(Object.keys(s.toneConfusion).length).toBe(2);
  });

  it('groups Top-5 hit rate by expected text length', () => {
    const items: EvalItemInput[] = [
      item('a', '你好', [3, 3], [3, 3], ['你好']),       // len 2 hit
      item('b', '谢谢', [4, 4], [4, 4], ['x']),          // len 2 miss
      item('c', '晚上好', [3, 4, 3], [3, 4, 3], ['晚上好']), // len 3 hit
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
    expect(s.latencyMs.p50).toBe(6);   // index floor(10*0.5)=5 → value 6
    expect(s.latencyMs.p95).toBe(100); // index floor(10*0.95)=9 → value 100
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
```

- [ ] **Step 3: 确认测试失败**

```bash
npm test
```

Expected: 6 tests FAIL（`aggregate` 不存在）。

- [ ] **Step 4: 实现**

`src/eval/metrics.ts`：

```ts
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
```

- [ ] **Step 5: 确认测试通过**

```bash
npm test
```

Expected: 6 metrics tests + 3 wav tests = 9 tests PASS。

- [ ] **Step 6: Commit**

```bash
git add src/eval/types.ts src/eval/metrics.ts src/eval/metrics.test.ts
git commit -m "feat(eval): metrics aggregation (Top-K, tone confusion, by-length, latency)

评测的指标口径要定死，不然每次跑出来的数没法跨时间对比。纯函数 aggregate
拿逐条 item 产 summary，所有规则 (段数不等单独计 / Top-K 只认整句字符串匹配 /
混淆矩阵只在对齐部分累加) 都用测试锁住。"
```

---

## Task 4: phrases.txt + build_phrases.py

**Files:**
- Create: `eval/datasets/phrases.txt`
- Create: `scripts/build_phrases.py`
- Create: `eval/datasets/recordings/.gitkeep`
- Create: `eval/results/.gitkeep`
- Create: `.gitignore`（修改已有）

- [ ] **Step 1: 创建目录 + 占位文件**

```bash
mkdir -p eval/datasets/recordings eval/results
touch eval/datasets/recordings/.gitkeep eval/results/.gitkeep
```

- [ ] **Step 2: 写 phrases.txt 草案（25 条）**

`eval/datasets/phrases.txt`：

```
# DictateHmm eval phrase script.
# 一行一条中文短语；# 开头的行是注释。
# 编译：npm run build:phrases

# 单字 × 5 声调（第 5 声用中性音字：的/了/吗/吧，这里挑"的"）
啊
鱼
好
是
的

# 双字高频
你好
谢谢
晚安
再见
加油
没事
对不起
不客气

# 三字
吃了吗
怎么了
晚上好
我爱你
没关系

# 四字
辛苦了啊
有空吗哥
明天见啊
你在干嘛

# 五字
今天好累啊
晚上吃什么
我想你了啊
```

- [ ] **Step 3: 写 build_phrases.py**

`scripts/build_phrases.py`：

```python
#!/usr/bin/env python3
"""Compile eval/datasets/phrases.txt (+ optional phrases_freeform.txt) into phrases.json.

Schema of phrases.json:
  [ { "id": "p001", "text": "你好", "pinyin": "nǐ hǎo",
      "toneSeq": [3, 3], "source": "script" }, ... ]

ID scheme:
  - p001..p499 reserved for script entries (phrases.txt order)
  - p500+ for freeform entries (phrases_freeform.txt order)

Tone digit:
  - 1..4 normal tones
  - 5 for neutral (pypinyin's 0 remapped to 5); same as build_tone_index.py
"""

from __future__ import annotations
import json
import sys
from pathlib import Path

from pypinyin import lazy_pinyin, Style

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "eval" / "datasets" / "phrases.txt"
FREEFORM_PATH = ROOT / "eval" / "datasets" / "phrases_freeform.txt"
OUT_PATH = ROOT / "eval" / "datasets" / "phrases.json"

SCRIPT_ID_START = 1
FREEFORM_ID_START = 500


def is_chinese_char(ch: str) -> bool:
    return "\u4e00" <= ch <= "\u9fff"


def all_chinese(word: str) -> bool:
    return bool(word) and all(is_chinese_char(c) for c in word)


def tone_of_syllable(s: str) -> int:
    if s and s[-1].isdigit():
        t = int(s[-1])
        return 5 if t == 0 else t
    return 5


def compile_phrase(text: str) -> tuple[str, list[int]] | None:
    syllables = lazy_pinyin(text, style=Style.TONE3, neutral_tone_with_five=True)
    if len(syllables) != len(text):
        return None
    tones = [tone_of_syllable(s) for s in syllables]
    return " ".join(syllables), tones


def read_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    out = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        out.append(line)
    return out


def main() -> int:
    entries: list[dict] = []
    seen: set[str] = set()

    script_lines = read_lines(SCRIPT_PATH)
    for i, text in enumerate(script_lines):
        if not all_chinese(text):
            print(f"skip non-Chinese script line: {text!r}", file=sys.stderr)
            continue
        if text in seen:
            continue
        compiled = compile_phrase(text)
        if compiled is None:
            print(f"could not compile script line: {text!r}", file=sys.stderr)
            continue
        pinyin, tones = compiled
        entries.append({
            "id": f"p{SCRIPT_ID_START + i:03d}",
            "text": text,
            "pinyin": pinyin,
            "toneSeq": tones,
            "source": "script",
        })
        seen.add(text)

    freeform_lines = read_lines(FREEFORM_PATH)
    for i, text in enumerate(freeform_lines):
        if not all_chinese(text) or text in seen:
            continue
        compiled = compile_phrase(text)
        if compiled is None:
            continue
        pinyin, tones = compiled
        entries.append({
            "id": f"p{FREEFORM_ID_START + i:03d}",
            "text": text,
            "pinyin": pinyin,
            "toneSeq": tones,
            "source": "freeform",
        })
        seen.add(text)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    n_script = sum(1 for e in entries if e["source"] == "script")
    n_free = sum(1 for e in entries if e["source"] == "freeform")
    print(f"wrote {OUT_PATH} ({len(entries)} entries: script={n_script}, freeform={n_free})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 跑一遍**

```bash
npm run build:phrases
```

Expected: 打印 `wrote .../phrases.json (25 entries: script=25, freeform=0)` 左右；
`eval/datasets/phrases.json` 出现。

- [ ] **Step 5: 手工抽查**

```bash
head -20 eval/datasets/phrases.json
```

Expected: 第一条是 `你好`？不对——第一条应该是"啊"（单字组的第一行）。
前 5 条应该是：啊 / 鱼 / 好 / 是 / 的，各自 toneSeq 长度 1。

- [ ] **Step 6: .gitignore**

在仓库根的 `.gitignore`（如果不存在就新建）里加：

```
eval/results/*.json
```

保留 `.gitkeep`。录音文件 (`eval/datasets/recordings/*.wav`) **不**忽略——我们要
commit 进仓库做复现（Phase 1 规模 <20 MB）。

- [ ] **Step 7: Commit**

```bash
git add eval/ scripts/build_phrases.py .gitignore
git commit -m "feat(eval): phrases.txt seed + build_phrases.py compiler

评测脚本人维护 phrases.txt, 编译成 phrases.json (id/text/pinyin/toneSeq/source)
供前端录制页加载。复用 build_tone_index.py 同款 pypinyin + TONE3 口径，保证
声调标注来源和声调索引对齐。第一批 25 条草案覆盖 1-5 字 + 5 个声调。"
```

---

## Task 5: Vite dev 插件

**Files:**
- Create: `scripts/vite-plugin-eval-io.ts`
- Modify: `vite.config.ts`

背景：浏览器不能写任意磁盘，这个插件在 dev server 上挂 5 个端点做桥接。
只在 `apply: 'serve'` 下注册，生产 build 完全绕过。

- [ ] **Step 1: 实现插件**

`scripts/vite-plugin-eval-io.ts`：

```ts
import type { Plugin } from 'vite';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

type IncomingMsg = import('node:http').IncomingMessage;
type ServerResp = import('node:http').ServerResponse;

const EVAL_DIR = path.resolve(process.cwd(), 'eval');
const DATASETS = path.join(EVAL_DIR, 'datasets');
const RECORDINGS = path.join(DATASETS, 'recordings');
const RESULTS = path.join(EVAL_DIR, 'results');
const LABELS = path.join(DATASETS, 'labels.json');
const PHRASES = path.join(DATASETS, 'phrases.json');

// Serialize all label writes (single local user, so a simple chain is enough).
let labelsChain: Promise<void> = Promise.resolve();

export function vitePluginEvalIO(): Plugin {
  return {
    name: 'dictatehmm-eval-io',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__eval/phrases.json', handler(async (_req, res) => {
        const data = await readJsonOrDefault(PHRASES, []);
        sendJson(res, data);
      }));

      server.middlewares.use('/__eval/labels.json', handler(async (_req, res) => {
        const data = await readJsonOrDefault(LABELS, []);
        sendJson(res, data);
      }));

      server.middlewares.use('/__eval/save-wav', handler(async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, 'method not allowed');
        const body = await readBody(req);
        const { filename, base64Wav } = JSON.parse(body);
        if (!/^[a-z0-9_]+\.wav$/i.test(filename)) return send(res, 400, 'bad filename');
        await fs.mkdir(RECORDINGS, { recursive: true });
        const bytes = Buffer.from(base64Wav, 'base64');
        await fs.writeFile(path.join(RECORDINGS, filename), bytes);
        sendJson(res, { ok: true, path: `eval/datasets/recordings/${filename}` });
      }));

      server.middlewares.use('/__eval/append-labels', handler(async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, 'method not allowed');
        const body = await readBody(req);
        const { entry } = JSON.parse(body);
        if (!entry || typeof entry.id !== 'string' || typeof entry.file !== 'string') {
          return send(res, 400, 'bad entry');
        }
        labelsChain = labelsChain.then(async () => {
          await fs.mkdir(DATASETS, { recursive: true });
          const existing = await readJsonOrDefault(LABELS, [] as any[]);
          existing.push(entry);
          await fs.writeFile(LABELS, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
        });
        await labelsChain;
        sendJson(res, { ok: true });
      }));

      server.middlewares.use('/__eval/save-results', handler(async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, 'method not allowed');
        const body = await readBody(req);
        const payload = JSON.parse(body);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const gitSha = tryGitSha();
        const filename = `${ts}.json`;
        await fs.mkdir(RESULTS, { recursive: true });
        await fs.writeFile(
          path.join(RESULTS, filename),
          JSON.stringify({ ...payload, gitSha }, null, 2) + '\n',
          'utf-8',
        );
        sendJson(res, { ok: true, filename });
      }));

      // Serve WAV files straight from eval/datasets/recordings/ (Vite's publicDir doesn't
      // cover this path). GET /__eval/recordings/<filename>
      server.middlewares.use('/__eval/recordings', handler(async (req, res) => {
        const url = req.url || '';
        const m = url.match(/^\/([a-z0-9_]+\.wav)$/i);
        if (!m) return send(res, 404, 'not found');
        const full = path.join(RECORDINGS, m[1]);
        if (!existsSync(full)) return send(res, 404, 'not found');
        const data = await fs.readFile(full);
        res.statusCode = 200;
        res.setHeader('content-type', 'audio/wav');
        res.end(data);
      }));
    },
  };
}

function handler(
  fn: (req: IncomingMsg, res: ServerResp) => Promise<void>,
): (req: IncomingMsg, res: ServerResp, next: (e?: unknown) => void) => void {
  return (req, res, next) => {
    fn(req, res).catch((e) => {
      console.error('[eval-io]', e);
      try { send(res, 500, String(e?.message ?? e)); } catch { /* ignore */ }
      next(e);
    });
  };
}

async function readBody(req: IncomingMsg): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

async function readJsonOrDefault<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function sendJson(res: ServerResp, body: unknown): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function send(res: ServerResp, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain');
  res.end(body);
}

function tryGitSha(): string | undefined {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 2: 挂插件**

改 `vite.config.ts`：

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vitePluginEvalIO } from './scripts/vite-plugin-eval-io';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), vitePluginEvalIO()],
});
```

- [ ] **Step 3: 类型检查通过**

```bash
npx tsc -b
```

Expected: 无错误。

- [ ] **Step 4: 手工验证所有端点**

在一个终端跑 `npm run dev`，在另一个终端：

```bash
# 1) GET phrases.json
curl -s http://localhost:5173/__eval/phrases.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('phrases:', len(d))"

# 2) GET labels.json (空, 应返回 [])
curl -s http://localhost:5173/__eval/labels.json

# 3) POST save-wav (tiny fake WAV: 44 字节头 + 2 字节数据)
python3 - <<'PY' | base64 > /tmp/fake.b64
import struct
hdr = b'RIFF' + struct.pack('<I', 38) + b'WAVE' + b'fmt ' + struct.pack('<I', 16) \
    + struct.pack('<HHIIHH', 1, 1, 16000, 32000, 2, 16) + b'data' + struct.pack('<I', 2) + b'\x00\x00'
import sys; sys.stdout.buffer.write(hdr)
PY
curl -s -X POST http://localhost:5173/__eval/save-wav \
  -H 'content-type: application/json' \
  -d "{\"filename\":\"test_001.wav\",\"base64Wav\":\"$(cat /tmp/fake.b64)\"}"

# 4) GET 回那个 WAV
curl -s -I http://localhost:5173/__eval/recordings/test_001.wav | head -3

# 5) POST append-labels
curl -s -X POST http://localhost:5173/__eval/append-labels \
  -H 'content-type: application/json' \
  -d '{"entry":{"id":"p001","file":"test_001.wav","recordedAt":"2026-04-19T00:00:00Z"}}'
cat eval/datasets/labels.json

# 6) POST save-results
curl -s -X POST http://localhost:5173/__eval/save-results \
  -H 'content-type: application/json' \
  -d '{"summary":{"n":0}}'
ls eval/results/
```

Expected:
- (1) `phrases: 25` 左右
- (2) `[]`
- (3) `{"ok":true,"path":"eval/datasets/recordings/test_001.wav"}`
- (4) `HTTP/1.1 200 OK` 和 `content-type: audio/wav`
- (5) `labels.json` 里有一条 p001 记录
- (6) `eval/results/` 下出现一个 `.json`

- [ ] **Step 5: 清理验证产物**

```bash
rm -f eval/datasets/recordings/test_001.wav eval/datasets/labels.json eval/results/*.json
```

- [ ] **Step 6: Commit**

```bash
git add scripts/vite-plugin-eval-io.ts vite.config.ts
git commit -m "feat(eval): Vite dev plugin for /__eval/* write endpoints

浏览器不能直接写磁盘，但评测工具需要落盘录音/标注/结果。用 Vite
dev 插件 (apply: 'serve') 暴露 5 个端点，生产 build 不打包这个插件。
labels.json 的 append 用进程内 Promise chain 串行化，避免并发重写。
录音文件名硬校验 /^[a-z0-9_]+\\.wav$/i 防路径遍历。"
```

---

## Task 6: 路由骨架

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Create: `src/eval/pages/EvalIndex.tsx`
- Create: `src/eval/pages/EvalRecord.tsx`
- Create: `src/eval/pages/EvalRun.tsx`

背景：现在 `App.tsx` 直接是根组件，要换成 router。`App` 组件保持现有行为（不动），
只是从"根"变成"路由之一"。三个 eval 页面先放占位，后续 task 填充。

- [ ] **Step 1: 重构 main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import App from './App.tsx';
import { EvalIndex } from './eval/pages/EvalIndex.tsx';
import { EvalRecord } from './eval/pages/EvalRecord.tsx';
import { EvalRun } from './eval/pages/EvalRun.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/eval" element={<EvalIndex />} />
        <Route path="/eval/record" element={<EvalRecord />} />
        <Route path="/eval/run" element={<EvalRun />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 2: EvalIndex.tsx（占位）**

```tsx
import { Link } from 'react-router-dom';

export function EvalIndex() {
  return (
    <div className="app">
      <header>
        <h1>Eval</h1>
        <p className="subtitle">DictateHmm 评测工具</p>
      </header>
      <nav style={{ display: 'flex', gap: 16, padding: 24 }}>
        <Link to="/eval/record">🎙 录制</Link>
        <Link to="/eval/run">📊 跑评测</Link>
        <Link to="/">← 返回输入法</Link>
      </nav>
    </div>
  );
}
```

- [ ] **Step 3: EvalRecord.tsx（占位）**

```tsx
import { Link } from 'react-router-dom';

export function EvalRecord() {
  return (
    <div className="app">
      <header>
        <h1>Eval · 录制</h1>
        <Link to="/eval">← eval 首页</Link>
      </header>
      <p style={{ padding: 24 }}>待实现（Task 7 会覆盖此文件）</p>
    </div>
  );
}
```

- [ ] **Step 4: EvalRun.tsx（占位）**

```tsx
import { Link } from 'react-router-dom';

export function EvalRun() {
  return (
    <div className="app">
      <header>
        <h1>Eval · 跑评测</h1>
        <Link to="/eval">← eval 首页</Link>
      </header>
      <p style={{ padding: 24 }}>待实现（Task 8 会覆盖此文件）</p>
    </div>
  );
}
```

- [ ] **Step 5: 验证构建 + 路由**

```bash
npm run build
npm run dev
```

在浏览器里分别打开：
- http://localhost:5173/ —— 输入法主页（原有功能不变）
- http://localhost:5173/eval —— 两个链接
- http://localhost:5173/eval/record —— TODO 页
- http://localhost:5173/eval/run —— TODO 页

Expected: 四个路由都能渲染，`/` 录音仍然正常工作。

- [ ] **Step 6: Commit**

```bash
git add src/main.tsx src/eval/pages/
git commit -m "feat(eval): router + page skeletons for /eval/record and /eval/run

之前 App.tsx 是根组件，现在挂到 react-router-dom 下面做了路由层。
主页行为不变，evaluation 工具走 /eval 子树。"
```

---

## Task 7: EvalRecord 页面

**Files:**
- Create: `src/eval/api.ts`
- Modify: `src/eval/pages/EvalRecord.tsx`

背景：完整的录制引导。从 `/__eval/phrases.json` + `/__eval/labels.json` 加载状态，
按"已录次数升序"排列，选中的 phrase 做完整 record → 试听 → 保存。

- [ ] **Step 1: 客户端 API wrapper**

`src/eval/api.ts`：

```ts
import type { Label, Phrase } from './types';

export async function fetchPhrases(): Promise<Phrase[]> {
  const r = await fetch('/__eval/phrases.json', { cache: 'no-store' });
  if (!r.ok) throw new Error(`phrases.json: ${r.status}`);
  return r.json();
}

export async function fetchLabels(): Promise<Label[]> {
  const r = await fetch('/__eval/labels.json', { cache: 'no-store' });
  if (!r.ok) throw new Error(`labels.json: ${r.status}`);
  return r.json();
}

export async function saveWav(filename: string, wav: Uint8Array): Promise<void> {
  const base64Wav = bytesToBase64(wav);
  const r = await fetch('/__eval/save-wav', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename, base64Wav }),
  });
  if (!r.ok) throw new Error(`save-wav: ${r.status} ${await r.text()}`);
}

export async function appendLabel(entry: Label): Promise<void> {
  const r = await fetch('/__eval/append-labels', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entry }),
  });
  if (!r.ok) throw new Error(`append-labels: ${r.status} ${await r.text()}`);
}

export async function fetchRecording(file: string): Promise<ArrayBuffer> {
  const r = await fetch(`/__eval/recordings/${encodeURIComponent(file)}`, {
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`recording ${file}: ${r.status}`);
  return r.arrayBuffer();
}

export async function saveResults(result: unknown): Promise<string> {
  const r = await fetch('/__eval/save-results', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result),
  });
  if (!r.ok) throw new Error(`save-results: ${r.status} ${await r.text()}`);
  const { filename } = await r.json();
  return filename;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
```

- [ ] **Step 2: 实现 EvalRecord（完整页面）**

`src/eval/pages/EvalRecord.tsx` —— 覆盖占位：

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { startCapture } from '../../audio/capture';
import type { CaptureSession } from '../../audio/capture';
import { encodeWav } from '../wav';
import { appendLabel, fetchLabels, fetchPhrases, saveWav } from '../api';
import type { Label, Phrase } from '../types';

type RecState =
  | { kind: 'idle' }
  | { kind: 'recording'; session: CaptureSession; startedAt: number }
  | { kind: 'reviewing'; samples: Float32Array; sampleRate: number; wav: Uint8Array; url: string };

const MAX_RECORD_MS = 5000;

export function EvalRecord() {
  const [phrases, setPhrases] = useState<Phrase[] | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [rec, setRec] = useState<RecState>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const autoStopRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const [p, l] = await Promise.all([fetchPhrases(), fetchLabels()]);
      setPhrases(p);
      setLabels(l);
      if (selectedId === null && p.length > 0) setSelectedId(p[0].id);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selectedId]);

  useEffect(() => { reload(); }, [reload]);

  const countById = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of labels) m.set(l.id, (m.get(l.id) ?? 0) + 1);
    return m;
  }, [labels]);

  const sorted = useMemo(() => {
    if (!phrases) return [];
    return [...phrases].sort((a, b) => {
      const ca = countById.get(a.id) ?? 0;
      const cb = countById.get(b.id) ?? 0;
      if (ca !== cb) return ca - cb;
      return a.id.localeCompare(b.id);
    });
  }, [phrases, countById]);

  const selected = phrases?.find((p) => p.id === selectedId) ?? null;

  const start = useCallback(async () => {
    setError(null);
    try {
      const session = await startCapture();
      const startedAt = performance.now();
      setRec({ kind: 'recording', session, startedAt });
      // 硬截止 5s
      autoStopRef.current = window.setTimeout(() => stop(), MAX_RECORD_MS) as unknown as number;
    } catch (e) {
      setError((e as Error).message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(async () => {
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    setRec((cur) => {
      if (cur.kind !== 'recording') return cur;
      // Kick off async stop outside the state setter.
      (async () => {
        try {
          const samples = await cur.session.stop();
          const wav = encodeWav(samples, cur.session.sampleRate);
          const blob = new Blob([wav], { type: 'audio/wav' });
          const url = URL.createObjectURL(blob);
          setRec({ kind: 'reviewing', samples, sampleRate: cur.session.sampleRate, wav, url });
        } catch (e) {
          setError((e as Error).message);
          setRec({ kind: 'idle' });
        }
      })();
      return cur;
    });
  }, []);

  const retake = useCallback(() => {
    setRec((cur) => {
      if (cur.kind === 'reviewing') URL.revokeObjectURL(cur.url);
      return { kind: 'idle' };
    });
  }, []);

  const save = useCallback(async () => {
    if (rec.kind !== 'reviewing' || !selected) return;
    const now = new Date();
    const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
    const hhmm = now.toISOString().slice(11, 16).replace(':', '');
    const seq = String((countById.get(selected.id) ?? 0) + 1).padStart(2, '0');
    const filename = `${selected.id}_${yyyymmdd}_${hhmm}_${seq}.wav`;
    try {
      await saveWav(filename, rec.wav);
      const entry: Label = {
        id: selected.id,
        file: filename,
        recordedAt: now.toISOString(),
      };
      if (note.trim()) entry.note = note.trim();
      await appendLabel(entry);
      URL.revokeObjectURL(rec.url);
      setRec({ kind: 'idle' });
      setNote('');
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [rec, selected, note, countById, reload]);

  if (!phrases) {
    return (
      <div className="app">
        <header><h1>Eval · 录制</h1></header>
        <p style={{ padding: 24 }}>{error ? `错误: ${error}` : '加载中…'}</p>
      </div>
    );
  }

  return (
    <div className="app" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <h1>Eval · 录制</h1>
        <Link to="/eval">← eval 首页</Link>
        <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
          {labels.length} 条录音 / {phrases.length} 条脚本 ({sorted.filter((p) => (countById.get(p.id) ?? 0) > 0).length} 条已录)
        </span>
      </header>

      {error && <div className="error">错误：{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24, padding: 16 }}>
        <aside style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <h3>脚本</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {sorted.map((p) => {
              const c = countById.get(p.id) ?? 0;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => setSelectedId(p.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 8px',
                      background: p.id === selectedId ? '#334' : 'transparent',
                      color: 'inherit',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ opacity: 0.5 }}>{p.id}</span> · {p.text}
                    <span style={{ float: 'right', opacity: 0.7 }}>×{c}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main>
          {selected && (
            <section>
              <div style={{ fontSize: 48, fontWeight: 700, marginBottom: 8 }}>{selected.text}</div>
              <div style={{ opacity: 0.7, marginBottom: 4 }}>{selected.pinyin}</div>
              <div style={{ opacity: 0.5, fontFamily: 'monospace', marginBottom: 24 }}>
                tone: {selected.toneSeq.join('-')}
              </div>

              {rec.kind === 'idle' && (
                <button className="mic" onClick={start}>🎤 录</button>
              )}
              {rec.kind === 'recording' && (
                <button className="mic mic-on" onClick={stop}>⏹ 停（自动 5s）</button>
              )}
              {rec.kind === 'reviewing' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
                  <audio src={rec.url} controls />
                  <input
                    placeholder="note（可选，例如 quiet / keyboard / tired）"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={save}>💾 保存</button>
                    <button onClick={retake}>🔁 重录</button>
                  </div>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 手工跑完整流程**

```bash
npm run dev
```

在浏览器里打开 http://localhost:5173/eval/record：

1. 左栏应该有 25 条，"× 0" 计数都在右边。
2. 选中第一条（"啊"），按「🎤 录」，哼一声，按「⏹ 停」或等 5 秒自动停。
3. 应该出现 `<audio>` 可以试听。填个 note 「test」。
4. 按「💾 保存」。
5. 刷新页面：左栏"啊"应该计数变成 `× 1` 并且排到队尾。

磁盘验证：

```bash
ls eval/datasets/recordings/
cat eval/datasets/labels.json
```

Expected: 一个 `p001_YYYYMMDD_HHMM_01.wav` 文件；`labels.json` 里有对应一条。

- [ ] **Step 4: 清掉验证录音**

```bash
rm eval/datasets/recordings/*.wav
rm eval/datasets/labels.json
```

（正式录制时这些会重新积累，现在我们只是把工具跑通。）

- [ ] **Step 5: Commit**

```bash
git add src/eval/api.ts src/eval/pages/EvalRecord.tsx
git commit -m "feat(eval): record page with phrase list + record/review/save flow

走现有 startCapture() + encodeWav()，保存通过 Vite 插件的 save-wav /
append-labels 端点落盘。脚本按已录次数升序排序 (录得少的在顶)，5s 硬
截止防手残，试听后可重录或带 note 保存。"
```

---

## Task 8: EvalRun 页面

**Files:**
- Modify: `src/eval/pages/EvalRun.tsx`

背景：拉齐所有 (phrase × last label) 样本，串行跑 `runPipeline`，产指标和明细，
POST 保存 JSON。

- [ ] **Step 1: 实现完整页面**

`src/eval/pages/EvalRun.tsx`：

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ToneIndex, ToneLabel } from '../../types';
import { runPipeline } from '../../pipeline';
import { aggregate } from '../metrics';
import { fetchLabels, fetchPhrases, fetchRecording, saveResults } from '../api';
import type { EvalItemInput, EvalRunResult, Label, Phrase } from '../types';

type RunProgress =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; result: EvalRunResult; savedAs: string };

export function EvalRun() {
  const [phrases, setPhrases] = useState<Phrase[] | null>(null);
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [index, setIndex] = useState<ToneIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunProgress>({ kind: 'idle' });

  useEffect(() => {
    (async () => {
      try {
        const [p, l, ir] = await Promise.all([
          fetchPhrases(),
          fetchLabels(),
          fetch('/data/tone-index.json').then((r) => r.json() as Promise<ToneIndex>),
        ]);
        setPhrases(p);
        setLabels(l);
        setIndex(ir);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const pairs = useMemo(() => {
    if (!phrases || !labels) return [];
    // Group labels by id, keep the newest recordedAt per id.
    const latest = new Map<string, Label>();
    for (const l of labels) {
      const prev = latest.get(l.id);
      if (!prev || prev.recordedAt < l.recordedAt) latest.set(l.id, l);
    }
    const out: Array<{ phrase: Phrase; label: Label }> = [];
    for (const p of phrases) {
      const l = latest.get(p.id);
      if (l) out.push({ phrase: p, label: l });
    }
    return out;
  }, [phrases, labels]);

  const run = useCallback(async () => {
    if (!index || pairs.length === 0) return;
    setError(null);
    setProgress({ kind: 'running', done: 0, total: pairs.length });
    const ac = new AudioContext();
    const items: EvalItemInput[] = [];
    try {
      for (let i = 0; i < pairs.length; i++) {
        const { phrase, label } = pairs[i];
        const buf = await fetchRecording(label.file);
        const audio = await ac.decodeAudioData(buf.slice(0)); // slice to avoid detached buffer
        const samples = audio.getChannelData(0);
        const t0 = performance.now();
        const pipeline = runPipeline(new Float32Array(samples), audio.sampleRate, index);
        const latencyMs = performance.now() - t0;

        items.push({
          id: phrase.id,
          file: label.file,
          expected: { text: phrase.text, toneSeq: phrase.toneSeq as ToneLabel[] },
          actual: {
            toneSeq: pipeline.toneSeq,
            toneSeqAlt: pipeline.altToneSeqs,
            top20: pipeline.candidates.slice(0, 20).map((c) => ({
              text: c.text, pinyin: c.pinyin, score: c.score,
            })),
          },
          latencyMs,
        });
        setProgress({ kind: 'running', done: i + 1, total: pairs.length });
      }
      const result = aggregate(items);
      result.indexMeta = { totalPhrases: index.meta.totalPhrases, uniqueToneSeqs: index.meta.uniqueToneSeqs };
      const savedAs = await saveResults(result);
      setProgress({ kind: 'done', result, savedAs });
    } catch (e) {
      setError((e as Error).message);
      setProgress({ kind: 'idle' });
    } finally {
      await ac.close();
    }
  }, [index, pairs]);

  const coverage = phrases && labels
    ? `${pairs.length} / ${phrases.length} 条脚本有录音`
    : '…';

  return (
    <div className="app" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <h1>Eval · 跑评测</h1>
        <Link to="/eval">← eval 首页</Link>
        <span style={{ marginLeft: 'auto', opacity: 0.6 }}>{coverage}</span>
      </header>

      {error && <div className="error">错误：{error}</div>}

      <section style={{ padding: 16 }}>
        <button
          onClick={run}
          disabled={progress.kind === 'running' || !index || pairs.length === 0}
        >
          ▶ Run Eval
        </button>
        {progress.kind === 'running' && (
          <span style={{ marginLeft: 12 }}>
            {progress.done} / {progress.total}
          </span>
        )}
        {progress.kind === 'done' && (
          <span style={{ marginLeft: 12, opacity: 0.7 }}>
            已写入 eval/results/{progress.savedAs}
          </span>
        )}
      </section>

      {progress.kind === 'done' && <SummaryView result={progress.result} />}
    </div>
  );
}

function SummaryView({ result }: { result: EvalRunResult }) {
  const { summary, items } = result;
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <h2>Summary</h2>
        <table>
          <tbody>
            <tr><td>n</td><td>{summary.n}</td></tr>
            <tr><td>Top-1</td><td>{(summary.topK.top1 * 100).toFixed(1)}%</td></tr>
            <tr><td>Top-5</td><td>{(summary.topK.top5 * 100).toFixed(1)}%</td></tr>
            <tr><td>Top-20</td><td>{(summary.topK.top20 * 100).toFixed(1)}%</td></tr>
            <tr><td>段数错误率</td><td>{(summary.segmentCountMismatchRate * 100).toFixed(1)}%</td></tr>
            <tr><td>延迟 p50/p95/mean</td>
                <td>{summary.latencyMs.p50.toFixed(0)} / {summary.latencyMs.p95.toFixed(0)} / {summary.latencyMs.mean.toFixed(0)} ms</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>声调准确率（按位置）</h2>
        <table>
          <thead><tr><th>位置</th><th>准确率</th></tr></thead>
          <tbody>
            {summary.toneAccuracyByPos.map((v, i) => (
              <tr key={i}><td>{i}</td><td>{(v * 100).toFixed(1)}%</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>声调混淆矩阵</h2>
        <table>
          <thead><tr><th>期望→实际</th><th>次数</th></tr></thead>
          <tbody>
            {Object.entries(summary.toneConfusion)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <tr key={k}><td>{k}</td><td>{v}</td></tr>
              ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>按字数拆</h2>
        <table>
          <thead><tr><th>字数</th><th>n</th><th>Top-5</th></tr></thead>
          <tbody>
            {Object.entries(summary.byLen).sort().map(([k, v]) => (
              <tr key={k}><td>{k}</td><td>{v.n}</td><td>{(v.top5 * 100).toFixed(1)}%</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>明细</h2>
        <table>
          <thead>
            <tr>
              <th>id</th><th>期望</th><th>检出声调</th><th>期望声调</th>
              <th>Top-1</th><th>Top-5 / 20</th><th>ms</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const idx = it.actual.top20.findIndex((c) => c.text === it.expected.text);
              const hit1 = idx === 0;
              const hit5 = idx >= 0 && idx < 5;
              const hit20 = idx >= 0 && idx < 20;
              return (
                <tr key={it.id}>
                  <td>{it.id}</td>
                  <td>{it.expected.text}</td>
                  <td style={{ fontFamily: 'monospace' }}>{it.actual.toneSeq.join('-')}</td>
                  <td style={{ fontFamily: 'monospace', opacity: 0.7 }}>{it.expected.toneSeq.join('-')}</td>
                  <td>{hit1 ? '✓' : (it.actual.top20[0]?.text ?? '—')}</td>
                  <td>{hit5 ? '5 ✓' : hit20 ? '20 ✓' : '—'}</td>
                  <td>{it.latencyMs.toFixed(0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: 手工验证（至少 3 条录音）**

这一步需要先去 `/eval/record` 录 3 条（挑短的：你好、谢谢、再见）。然后：

```bash
npm run dev
```

打开 http://localhost:5173/eval/run：

1. 页面顶部应显示 "3 / 25 条脚本有录音"。
2. 按「▶ Run Eval」。进度条 1/3 → 2/3 → 3/3 几秒内跑完。
3. 下面应渲染 Summary / 按位置声调 / 混淆矩阵 / 按字数 / 明细 五个表格。
4. "已写入 eval/results/YYYY-MM-DDTHH-MM-SS.json" 提示出现。
5. 磁盘上对应文件存在：`ls eval/results/`。

- [ ] **Step 3: 清验证产物**

```bash
# 保留录音和结果，还是清掉？这批是手工跑通工具用的，不是真正的评测集。
# 推荐清掉，避免污染后面正式的第一批评测。
rm -f eval/results/*.json
rm -f eval/datasets/recordings/*.wav
rm -f eval/datasets/labels.json
```

- [ ] **Step 4: Commit**

```bash
git add src/eval/pages/EvalRun.tsx
git commit -m "feat(eval): run page — batch pipeline + metrics rendering + save

严格复用 runPipeline (包括浏览器原生采样率 → resampleTo16k)，按 id
group labels 只取 recordedAt 最新那条。串行跑避免 AudioContext 竞争。
结果落到 eval/results/<iso-ts>.json 附 git sha。"
```

---

## Task 9: README + 收尾

**Files:**
- Create: `eval/README.md`

- [ ] **Step 1: 写 README**

`eval/README.md`：

```markdown
# DictateHmm Eval

工具路径：仓库根跑 `npm run dev`，浏览器打开 `http://localhost:5173/eval`。

## 目录

- `datasets/phrases.txt` —— 脚本，人维护。一行一条中文，`#` 开头是注释。
- `datasets/phrases.json` —— 编译产物。`npm run build:phrases` 生成。commit 进仓库。
- `datasets/phrases_freeform.txt` —— 可选。录制页自由模式的产物（目前 Phase 1 需手动写）。
- `datasets/labels.json` —— 录制时自动追加。一条 phrase 可多次录；评测只用最新那次。
- `datasets/recordings/*.wav` —— 录音，commit 进仓库（Phase 1 规模 < 20 MB）。
- `results/*.json` —— 每次跑评测落盘，**不 commit**（`.gitignore` 已忽略）。

## 工作流三步走

### 1. 编脚本

编辑 `datasets/phrases.txt`，加想要的短语。然后：

```bash
npm run build:phrases
```

把 `phrases.json` 也 commit 掉（声调口径用 pypinyin TONE3，和 `scripts/build_tone_index.py` 一致）。

### 2. 录音

```bash
npm run dev
```

浏览器打开 `http://localhost:5173/eval/record`。左栏选一条，「🎤 录」→ 试听 → 「💾 保存」。
脚本按"已录次数升序"排序，所以录得最少的一直排最上面；顺着录就行。

### 3. 跑评测

```bash
npm run dev   # 如果没在跑
```

浏览器打开 `http://localhost:5173/eval/run`。按「▶ Run Eval」。几秒到几十秒后看表格。
结果 JSON 自动落到 `results/<iso-ts>.json`。

## 指标口径（写死别改）

- **Top-K 命中**：`expected.text` 必须**整句**出现在 `candidates[0..K)` 的 text 字段里。
- **声调准确率（按位置）**：只在段数对得上的样本上算。段数错误率**单独报**。
- **声调混淆矩阵**：键 `"期望→实际"`，只在段数对齐部分累加。
- **按字数拆**：按 `expected.text.length` 分桶，每桶报 Top-5。
- **延迟**：`sum(pipeline.timings)`，p50/p95/mean。

这些在 `src/eval/metrics.ts` 有测试锁住，别随意改，否则跨时间不可比。

## 已知限制

- Chrome/Edge 桌面。Safari / Firefox 的 AudioWorklet / FS API 没测。
- `/__eval/*` 端点只在 `npm run dev` 下存在（production build 绕过）。
- `phrases_freeform.txt` 的录制页自动追加 **Phase 1 未实现**。现在想加自由条目就手动
  写进 `phrases_freeform.txt` 再跑 `npm run build:phrases`。
```

- [ ] **Step 2: Commit**

```bash
git add eval/README.md
git commit -m "docs(eval): README for the eval harness workflow

三步走：编脚本 (phrases.txt + build:phrases) → 录音 (/eval/record) →
跑评测 (/eval/run)。把指标口径和已知限制写清楚，未来调参时避免自己
把硬口径改漂了。"
```

- [ ] **Step 3: 最终全量检查**

```bash
npm run build          # tsc -b + vite build 必须通过
npm test               # vitest 必须 PASS
npm run build:phrases  # 应打印 25 entries
```

三个命令全绿表示 Phase 1 工具链打通了。下一步是真正去录 20-30 条第一批数据，但那个
不是 Implementation Plan 的一部分，是"用这个工具去采数据"的运营动作。

- [ ] **Step 4: 推送**

```bash
git push -u origin claude/humming-input-method-vU28Z
```

（CLAUDE.md 约定：推到同一个分支；不自动建 PR。）

---

## Self-Review

### Spec coverage

| Spec 要求 | 实现 Task |
|---|---|
| `/eval/record` / `/eval/run` 路由 | Task 6 骨架，Task 7/8 内容 |
| 严格复用 `runPipeline` | Task 8（`runPipeline(samples, sampleRate, index)`） |
| `eval/datasets/` 目录结构 | Task 4 |
| Vite dev 插件 5 个端点 | Task 5 |
| phrases.txt → phrases.json | Task 4 |
| WAV 编码 16-bit PCM | Task 2 |
| 指标：Top-K / 混淆矩阵 / 按字数 / 延迟 / 段数错误单独报 | Task 3 |
| 多次录音按 recordedAt 最新取 | Task 8（pairs memo） |
| 录音文件名 `<id>_<YYYYMMDD>_<HHMM>_<NN>.wav` | Task 7 |
| 自由模式 `pendingCompile` | ✗ 未在 Phase 1 实现，README 中说明（Task 9）|
| 生产 build 不含插件 | Task 5（`apply: 'serve'`） |
| phrases.json + labels.json + recordings/*.wav 进仓库、results/*.json 不进 | Task 4（`.gitignore`） |

自由模式没有 Phase 1 实现，已在 spec 里就说"手动写进 phrases_freeform.txt"，Task 9 README
重复了这个限制，是一致的。

### Placeholder scan

没有 "TBD / TODO / implement later"。EvalRecord.tsx 和 EvalRun.tsx 占位版在 Task 6
里有占位文字，但 Task 7/8 都给了完整实现覆盖。OK。

### Type consistency

- `Phrase.toneSeq: ToneLabel[]` 在 types.ts / EvalRecord.tsx / EvalRun.tsx 一致。
- `Label.recordedAt: string` ISO，一致。
- `EvalItemInput` 字段名在 metrics.ts / EvalRun.tsx 之间一致（特别是 `actual.top20`）。
- `aggregate(items)` 返回 `EvalRunResult`，EvalRun.tsx 给它加了 `indexMeta` 后保存；
  EvalRunResult 的 `indexMeta?` 可选，OK。
- `saveResults` 返回 `filename: string`，客户端和服务端签名一致。

### Scope check

9 个 task 都在 Phase 1 spec 范围内。Phase 2（扩到 80-120 条 + 结果 diff 视图）
完全不在。合理。

---

## 执行选择

这个计划全部完成大约需要 2-3 小时（含手动录 3 条验证）。建议 **subagent-driven**：
每个 task 丢给独立 agent 跑完，回来 review 一下再起下一个；中间可以发现前面没预料到的
问题。若你倾向一次性内联做完，就走 inline。
