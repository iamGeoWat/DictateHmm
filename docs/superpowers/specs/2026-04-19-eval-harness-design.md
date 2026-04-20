# Eval Harness 设计稿（Phase 1）

**Date:** 2026-04-19
**Status:** 草案，待实施
**Scope:** 从零搭起 DictateHmm 的评测集和评测工具。Phase 1 先打通工具链 + 录 20–30 条
冒烟样本；Phase 2 再扩到系统覆盖的 80–120 条（同一套工具，不需要重写）。

## 为什么现在做

CLAUDE.md 里的 ROI 清单第 1 条是上下文 + LLM rerank，但在动 LLM rerank、n-gram LM、
CNN 声调分类之前，我们**没有任何回归保障**——随便调个参数，没法判断是变好还是变差。
用户试用会给定性反馈（"这个哼不出来"），但定性反馈沉淀不了指标。评测集是这个项目
接下来任何主路线改动的前置条件。

## 目标 / 非目标

要做的是：

- 在现有 Vite app 里加两条路由：`/eval/record`（录制引导）和 `/eval/run`（批量跑评测）。
  采集链路严格复用 `src/audio/capture.ts` 和 `src/pipeline.ts`，不另写一套——不然评测
  出来的数不能直接信。
- `eval/datasets/` 目录下结构化存放：脚本（`phrases.txt` + 编译产物 `phrases.json`）、
  录音（`recordings/*.wav`）、标注清单（`labels.json`）。
- `eval/results/` 存每次跑出来的指标 JSON（Top-K 命中率、声调混淆矩阵、按字数拆解、
  延迟 p50/p95、逐条明细）。
- Vite dev 插件负责把录音和指标写盘，浏览器不碰 File System Access API。

不做的：

- 不做 CI 集成，不做自动化回归。本地跑即可。
- 不做 production build 的评测路由（dev-only）。
- 不做多人协作（单用户本地工作流）。
- 不做跨浏览器支持（Chrome/Edge 桌面，和主应用一致）。
- Phase 1 不做"结果对比上一次 run"的 diff 视图（结果 JSON 先老老实实落盘，将来加）。

## 架构

路由：

- `/` —— 现有输入法，动不到
- `/eval` —— 简单导航页，两个卡片链到 record/run
- `/eval/record` —— 录制引导页
- `/eval/run` —— 批量跑 + 指标页

数据流（录制）：

```
phrases.txt ──build_phrases.py──▶ phrases.json
                                    │
                                    ▼
/eval/record ──getUserMedia──▶ WAV 编码 ──POST /__eval/save-wav──▶ recordings/*.wav
                                    │
                                    └─────POST /__eval/append-labels──▶ labels.json
```

数据流（评测）：

```
labels.json + recordings/*.wav
        │
        ▼
/eval/run ──fetch WAV──▶ decodeAudioData ──runPipeline──▶ per-sample result
                                                             │
                                                             ▼
                                               聚合指标 ──POST /__eval/save-results──▶
                                                             eval/results/<ts>.json
```

关键约束：评测管线和真实使用管线走**同一个 `runPipeline(samples, sampleRate, index)`**，
包括采样率（浏览器原生，通常 44.1/48 kHz）、`resampleTo16k`、F0 提取、分段、声调、
beam 候选。不能为了"方便"在评测里跳过任何一步。

## Vite dev 插件 `vitePluginEvalIO`

这是整个设计的关键。浏览器本身不能写任意磁盘目录，两个备选方案权衡下来：

- **File System Access API**：Chrome 原生，但每次冷启动要用户点一次"授权目录"，
  句柄要存 IndexedDB，写权限还会过期。工作流上多一层仪式感。
- **Vite dev 插件**：只在 `npm run dev` 生效（`apply: 'serve'`），通过 Vite 的 Connect
  中间件暴露几个端点。生产 build 不打包，零污染。统一、简单、不需要浏览器授权。

选后者。端点：

- `GET  /__eval/phrases.json` —— 直接读磁盘（绕过 Vite 静态缓存，避免编译后不刷新）
- `GET  /__eval/labels.json`  —— 同上
- `POST /__eval/save-wav` —— body `{ filename, base64Wav }`，写 `eval/datasets/recordings/<filename>`
  - 校验：filename 只允许 `[a-z0-9_]+\.wav`（防止路径遍历）
- `POST /__eval/append-labels` —— body `{ entry }`，读-append-写 `labels.json`
  - 互斥：进程内 mutex 串行化（单用户本地场景够用）
- `POST /__eval/save-results` —— body `{ result }`，写 `eval/results/<ts>.json`
  - 文件名由服务端生成，用 `new Date().toISOString().replace(...)`
- `GET  /__eval/recordings/<file>` —— 直接 `fs.createReadStream` 送 WAV（让 `/eval/run`
  能 fetch 到录音）

插件路径：`scripts/vite-plugin-eval-io.ts`（Node ESM，用 `fs/promises`、无第三方依赖）。

## 数据模型

**`phrases.txt`**（人维护，源头）：

```
# 一行一条，# 开头是注释
# 单字 × 5 声调
啊
鱼
好
是
的

# 双字高频
你好
谢谢
...
```

**`phrases.json`**（`build_phrases.py` 产物）：

```json
[
  { "id": "p001", "text": "你好", "pinyin": "nǐ hǎo", "toneSeq": [3, 3], "source": "script" },
  { "id": "p026", "text": "今天地铁真挤", "pinyin": "...", "toneSeq": [1,1,4,3,1,3], "source": "freeform" }
]
```

- `id`：`p` + 三位十进制递增，按 phrases.txt 出现顺序编号；freeform 从 `p500` 起。
- `source`: `"script"` | `"freeform"`，方便指标按来源拆。

**`labels.json`**（录制追加）：

```json
[
  { "id": "p001", "file": "p001_20260419_1532_01.wav", "recordedAt": "2026-04-19T15:32:18Z", "note": "quiet" }
]
```

一条 phrase 可以多次录（第 01、02 次）。**评测时每个 id 只取 `recordedAt` 最新的那条**，
Phase 1 不做"用哪一次"的切换 UI。如果想把某次作废，直接改 `labels.json` 删那行
（或把对应 WAV 删掉，跑评测时会自动跳过）。

**`eval/results/<ts>.json`**：

```ts
type Result = {
  runAt: string;             // ISO
  gitSha: string;            // 从 POST 时客户端拿不到，插件端跑 git 取
  indexMeta: { totalPhrases: number; uniqueToneSeqs: number };
  summary: {
    n: number;
    topK: { top1: number; top5: number; top20: number };  // 0..1
    toneAccuracyByPos: number[];        // 按位置，第 0 字、第 1 字……
    toneConfusion: Record<string, number>; // "1→2": 3, "3→1": 7, ...
    byLen: Record<string, { n: number; top5: number }>;   // "2": {n, top5}
    latencyMs: { p50: number; p95: number; mean: number };
  };
  items: Array<{
    id: string;
    file: string;
    expected: { text: string; toneSeq: number[] };
    actual: {
      toneSeq: number[];
      toneSeqAlt: number[][];
      top20: Array<{ text: string; pinyin: string; score: number }>;
    };
    hit: { top1: boolean; top5: boolean; top20: boolean };
    latencyMs: number;
  }>;
};
```

## 录制页 `/eval/record`

布局三栏：

- **左**：脚本列表，每条显示"文字 / 拼音 / 声调 / 已录次数"。默认按"已录次数升序"
  排，所以"录得少的"永远在顶。点一条切成"当前"。
- **中**：当前条卡片。大号中文、拼音、声调。按钮「🎤 录」（按住或点一下，都支持）；
  录完自动切到试听，有「重录」「保存」两按钮。录音时长硬上限 5s（防手残）。
- **右**：自由模式。输入框输入任意中文，跑一次客户端 pypinyin（见下）得到声调序列，
  录→存。这些条目最终会回写到 `phrases_freeform.txt`（`build_phrases.py` 下次编译时
  合并进 `phrases.json`）。

客户端怎么拿拼音？Python 不能在浏览器跑。两个选择：

- 自由模式的新条目先不算 toneSeq，保存时只存文字和音频，label 里 `pendingCompile: true`；
  下次跑 `build_phrases.py` 补上 toneSeq。
- 引入一个 JS 拼音库（pinyin-pro 等）。但会多几百 KB 资源，而且声调判定边界情况
  (轻声、儿化、变调) 和 pypinyin 可能有差异，造成评测时两套标注来源不一致。

选前者。自由模式录完显示"待编译"徽章，提示你跑一下 `npm run build:phrases`。

WAV 编码：16-bit PCM，浏览器 AudioContext 原生采样率（44.1 或 48 kHz），不在前端
重采样——重采样留给 pipeline，保持"录到什么样、评测就看到什么样"。写个小工具函数
`encodeWav(samples: Float32Array, sampleRate: number): Uint8Array`，放 `src/eval/wav.ts`。

文件名格式：`<id>_<YYYYMMDD>_<HHMM>_<NN>.wav`，`NN` 是今天该 id 的第几次录制。服务端
插件不负责生成文件名——客户端生成，服务端只负责写盘和校验格式。

## 跑评测页 `/eval/run`

极简：按钮「Run Eval」、进度条、指标卡片、明细表。

执行：

1. 拉 `labels.json` + `phrases.json`。按 `id` group `labels`，每组只留 `recordedAt`
   最新那条。再和 `phrases.json` join 出 `{ id, file, expected }[]`。没录过的 phrase
   不参与评测（但最后报表里会显示"N 条脚本，M 条已录，M/N 覆盖率"）。
2. 串行跑（不并行，避免 AudioContext 竞争 + UI 卡顿）。每条：
   - `fetch(/__eval/recordings/<file>)` → `arrayBuffer` → `AudioContext.decodeAudioData`
   - 拿到 `AudioBuffer.getChannelData(0)` 和 `buffer.sampleRate`
   - `runPipeline(samples, sampleRate, index)` → 计时
   - 算 hit：`actual.top20.findIndex(c => c.text === expected.text)`；-1 = 没命中。
3. 聚合指标（纯函数 `src/eval/metrics.ts`，好写单测）：
   - Top-K 命中率：命中在前 K 个的比例
   - 声调准确率（按位置）：逐条对位比较 `actual.toneSeq[i]` vs `expected.toneSeq[i]`，位置 i 的正确率
   - 声调混淆矩阵：遍历所有错位，累加 `expected→actual` 键
   - 按字数拆：`groupBy(expected.text.length)` 再算 Top-5
   - 延迟：pipeline `timings` 总和，sort 取 p50/p95
4. POST `/__eval/save-results`。
5. 页面渲染：顶部 summary 卡片；中部声调混淆矩阵（5×5 热力图）；下面明细表，每条
   可展开看 Top-20 + 声调序列 diff。

## phrases.txt 草案（25 条，Phase 1 起点）

```
# 单字 × 5 声调（第 5 声用中性字：的/了/吗）
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

分布不"严格均衡"，但打通工具链够用。第一次跑完会暴露出哪些声调组合我们还没覆盖，
到时候再往 Phase 2 扩。

## `scripts/build_phrases.py`

Python 脚本，复用现有 pypinyin 环境。读 `eval/datasets/phrases.txt` +
`phrases_freeform.txt`（可选），产出 `phrases.json`。

- ID 分配：script 源头从 p001 起，freeform 从 p500 起。
- 用 `lazy_pinyin(text, style=Style.TONE3, neutral_tone_with_five=True)`，和
  `scripts/build_tone_index.py` 保持一致。
- 检测到 `phrases_freeform.txt` 里有重复文字（已在 script 里的）直接跳过。
- 输出完打印 "wrote N phrases (script=X, freeform=Y)"。

为什么不在 Vite 启动时自动跑？两个原因：Python 依赖会漂移（`pypinyin` 必须在
PATH 里的 Python 环境装好）；启动时跑会让开发体验变慢。加个 `npm run build:phrases`
手动触发就行。录制页在拉 `phrases.json` 时如果发现 `phrases.txt` 的 mtime 比
`phrases.json` 新，在 UI 上弹一个 banner 提示"跑 npm run build:phrases"。

## 文件布局

```
eval/
├── README.md                       # 工作流三步走
├── datasets/
│   ├── phrases.txt                 # 人维护
│   ├── phrases_freeform.txt        # 录制页追加，人也可改
│   ├── phrases.json                # 构建产物，.gitignore？不，要 commit，方便跨机复现
│   ├── labels.json                 # 录制追加
│   └── recordings/
│       └── p001_20260419_1532_01.wav
└── results/
    └── 20260419-1532.json

scripts/
├── build_phrases.py                # 新增
├── build_tone_index.py             # 已存在
└── vite-plugin-eval-io.ts          # 新增

src/
├── eval/                           # 新增目录
│   ├── wav.ts                      # Float32 → 16-bit PCM WAV
│   ├── metrics.ts                  # 指标聚合纯函数
│   └── pages/
│       ├── EvalIndex.tsx
│       ├── EvalRecord.tsx
│       └── EvalRun.tsx
├── App.tsx                         # 加 router（react-router-dom 要新装）
└── ...（其余不动）
```

`recordings/*.wav` 是否 commit 进仓库？10 MB 级别可以 commit；到 Phase 2 的 80–120 条
（~30 MB）仍然在可接受范围。现在先 commit，将来如果真的超过 50 MB 再评估 git-lfs。

## 指标口径（写死，避免 "每次算法不一样"）

- **Top-K 命中**：`expected.text`（整句）在 `candidates.slice(0, K)` 的 `text` 列表里。
  **整句匹配**，不做部分匹配、不做同音字容忍。这个硬口径容易解读。
- **声调准确率（按位置）**：当 `segments.length === expected.toneSeq.length` 时才对位
  比较；段数不等直接记为"段数错误"（另一个计数）。位置 i 的准确率 = 对的/对比总数。
  **段数错误率单独报**，因为那是 segmentation 的问题不是声调分类的问题，不能混。
- **声调混淆矩阵**：只在段数对的那部分上累加。键 `"<expected>→<actual>"`，`2→3`
  表示应该是 2 但被判成 3。
- **按字数拆解**：按 `expected.text.length` 分桶，每桶报 Top-5。字数=段数=期望声调序列长度。
- **延迟**：`sum(Object.values(timings))`，单位 ms。p50/p95/mean。

## 实施步骤

1. **Vite dev 插件 + 空骨架**：`scripts/vite-plugin-eval-io.ts`，5 个端点都先 mock 返回
   200，能被 curl 到。挂到 `vite.config.ts`（只 dev）。
2. **phrase 流水线**：`scripts/build_phrases.py` + 初版 `phrases.txt` 草案 +
   `npm run build:phrases`。先产出 `phrases.json`，确认格式。
3. **`src/eval/wav.ts`** + 单测（给 1 帧正弦波编码再用 Node 读回来，验证头部正确）。
4. **路由 + `/eval/record`**：装 `react-router-dom`，写三个页面骨架，录制页跑通
   "选条→录→存 WAV→append labels"完整链路。
5. **`src/eval/metrics.ts`** + 单测（构造 3 条假 result，验证命中率、混淆矩阵、
   按字数拆都对）。
6. **`/eval/run`** 页面：拉、跑、存、展示。
7. **`eval/README.md`**：给未来的自己写"三步跑一次评测"。

每步独立可测。1→2→3 完成就已经能录、能存、能编码 WAV；加上 4 就是完整的录制工作流；
5 + 6 是评测工作流；7 收尾。中途任何一步卡住都不会带累后面。

## 遗留 tradeoffs

- **评测跑完后要不要自动在输入法主页显示"最新一次 Top-5: 47%"的徽章**？ 不做。保持
  主路径零污染。想看就去 `/eval/run`。
- **评测结果和 git sha 的关系**？结果里记 `gitSha`，但不强制 clean working tree。
  开发中随手跑是常态。
- **声调标注来源是 pypinyin**，和 `build_tone_index.py` 用同一个库同一个口径。如果
  未来发现 pypinyin 标的某些词（多音字、变调）和实际发音不一致，允许在 `phrases.json`
  里手动 override `toneSeq`——`build_phrases.py` 读到已有 `phrases.json` 中的
  `override: true` 条目会保留它的 `toneSeq` 不重算。Phase 1 先不实现 override 机制，
  遇到了再加。
