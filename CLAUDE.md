# CLAUDE.md — 项目接手文档

---

## 一句话项目描述

**DictateHmm**：一个中文哼哼输入法。用户闭嘴哼（只传声调+节奏，没有声母韵母），结合上下文，产生候选中文。MVP 阶段，验证可行性。

## 当前状态

**阶段：** MVP 链路全跑通 + 评测工具链 (eval harness) 已交付。**阻塞在"还没采第一批真实数据"**。

- ✅ 流水线 7 环全部打通（`src/{audio,pitch,segment,tone,rhythm,candidates}`）。
- ✅ 分段从绝对阈值 (-45 dBFS) 换成自适应相对阈值，**响度无关**。Safari 小声录音也能正常分段。
- ✅ 评测工具链：`/eval/record` 录音（带实时电平表）、`/eval/run` 批量评测、
  `eval/datasets/phrases.txt` 25 条草案脚本、`src/eval/metrics.ts` 指标口径。
- 🔲 **下一步是采第一批 20–30 条哼哼**（由用户在 Chrome 或 Safari 里录）→ 跑 `/eval/run` 拿基线数字 → 根据基线决定第一个大改点。

不要自动启动下一阶段工作。用户录完一批并跑过 eval 之后，再一起看数据决定改什么。

## 代码和文档快速导航

```
DictateHmm/
├── CLAUDE.md                  # 你在这里
├── README.md                  # 面向用户的"怎么跑"
├── docs/                      # 设计文档（方案对比、术语、计划）
│   ├── README.md              # 文档索引
│   ├── overview.md            # 问题、术语、成功标准
│   ├── architecture.md        # 流水线、数据接口、降级
│   ├── mvp-plan.md            # 2 阶段执行计划（阶段 1 = 自建 + 自评测，阶段 2 = 真实用户）
│   ├── references.md          # 开源项目、数据集、论文链接
│   └── stages/                # 每环节一份：问题定义 → 方案表 → MVP 选型 → 升级路径
│       ├── audio-capture.md
│       ├── pitch-extraction.md
│       ├── segmentation.md
│       ├── tone-classification.md
│       ├── rhythm-features.md
│       ├── candidate-matching.md
│       └── bypass-multimodal.md
├── src/
│   ├── audio/capture.ts       # getUserMedia + AudioWorklet
│   ├── pitch/extract.ts       # pitchy MPM + 中值滤波 + octave 修正
│   ├── segment/segment.ts     # 自适应阈值分段（+ segment.test.ts）
│   ├── tone/classify.ts       # 规则分类器（log z-score 后 slope/curvature/fMinPos）
│   ├── rhythm/features.ts
│   ├── candidates/match.ts    # beam search over tone × split
│   ├── pipeline.ts            # 编排
│   ├── types.ts               # 环节间接口
│   ├── App.tsx / App.css      # UI（主输入法页）
│   ├── main.tsx               # BrowserRouter 挂 / 和 /eval/*
│   ├── ui/PitchPlot.tsx
│   └── eval/                  # ★ 评测工具
│       ├── wav.ts             # Float32 → 16-bit PCM WAV（+ test）
│       ├── metrics.ts         # Top-K / 混淆矩阵 / 按字数拆 / 延迟（+ test）
│       ├── api.ts             # /__eval/* 端点客户端
│       ├── types.ts
│       └── pages/{EvalIndex,EvalRecord,EvalRun}.tsx
├── public/
│   ├── audio-worklet.js       # AudioWorklet processor（必须独立文件）
│   └── data/tone-index.json   # 构建产物，7 MB，已在仓库
├── scripts/
│   ├── build_tone_index.py    # jieba dict + pypinyin → tone-index.json
│   ├── build_phrases.py       # phrases.txt + pypinyin → phrases.json
│   └── vite-plugin-eval-io.ts # dev-only 写盘端点（/__eval/save-wav 等）
├── eval/                      # ★ 评测数据 + 结果
│   ├── README.md
│   ├── datasets/
│   │   ├── phrases.txt        # 脚本，人维护
│   │   ├── phrases.json       # 编译产物（commit）
│   │   ├── labels.json        # 录制时追加
│   │   └── recordings/*.wav   # 录音（commit）
│   ├── results/*.json         # 每次 run 的指标（.gitignore）
│   └── .venv/                 # pypinyin venv（.gitignore）
└── docs/superpowers/
    ├── specs/2026-04-19-eval-harness-design.md
    └── plans/2026-04-19-eval-harness.md
```

## 流水线

```
mic → AudioWorklet(16k) → pitchy F0 → segment → tone classify → rhythm → beam candidates
旁路（未实现）：mic → multimodal LLM → candidates
```

每环节**独立可测**：接口在 `src/types.ts`，每环节纯函数。F0 曲线有 `ui/PitchPlot`，声调/节奏有 debug 面板。定位 bug 先看 Debug 面板。

## 已做的关键决策（和为什么）

| 决策 | 为什么 |
|---|---|
| MVP 用浏览器，不做原生 | 最快跑通，单平台验证 |
| 用 pitchy（MPM）不用 PESTO/CREPE | MVP 阶段够用，20 KB 纯 JS 没依赖；鲁棒性不够再换 |
| 规则声调分类器，不训 CNN | MVP 先证伪/证实整链，Top-2 兜底交给候选层 |
| 强制段间 ≥ 150 ms 停顿 | 哼哼没有辅音 onset，传统 VAD 失效；用户配合是最简可靠方案 |
| 纯词频排序，不上 KenLM / LLM | MVP 阶段先跑通，先看基线差多少 |
| 声调索引来自 jieba dict.txt | 公开、免费、349K 词；MIN_FREQ=3，TOP_PER_SEQ=1500 |
| 手加了 BOOST_PHRASES | jieba 是新闻/web 语料，口语高频词（谢谢、再见、晚安）被低估 |
| 跳过 Phase 0（LLM 可行性验证） | LLM 成功 ≠ 主链路成功；不预测结果，浪费时间 |
| 旁路多模态 LLM 只留文档不实现 | 不是主路，文档保留作为产品化 fallback 备选 |

## 成功/失败标准（`docs/overview.md`）

1. 安静环境，3–5 字短语，Top-5 命中率 ≥ 60%
2. 端到端延迟 ≤ 1 s
3. 3+ 真实用户 10 分钟训练后能发一条消息

达不到三条之一 → 复盘，不强推产品化。

## 怎么跑

```bash
npm install
curl -L -o /tmp/jieba-dict.txt https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt
python3 -m pip install pypinyin
python3 scripts/build_tone_index.py   # 产出 public/data/tone-index.json
npm run dev                           # http://localhost:5173
npm run build                         # 类型检查 + 生产构建
```

`tone-index.json` 已在仓库内（7 MB）。重跑 `build_tone_index.py` 只在改索引逻辑或调参时需要。

## 预期的坑

- **AudioWorklet 必须独立文件**，不能 bundle — 在 `public/audio-worklet.js`。改它别移走。
- **浏览器 AudioContext 采样率不是 16 kHz**（通常 44.1/48）。`resampleTo16k` 在 `src/audio/capture.ts`，F0 前必须重采样。
- **Safari 支持**：capture + eval pipeline 在 Safari 测过（2026-04-21），录音电平
  偏低（RMS ~-66 dBFS）但自适应分段阈值之后能正常工作。AGC 在 Safari 上似乎
  没真正启用，用户实际录音声音要放到麦近一些。Chrome/Edge 仍是主要测试平台。
- **`/__eval/*` 端点只在 `npm run dev` 下有**（Vite 插件 `apply: 'serve'`）。
  production build 里没有这些路径，`/eval/record` `/eval/run` 会看着能打开但
  API 会全部 404。
- **pypinyin 在 eval/.venv 里**，不在系统 Python（Homebrew PEP 668）。
  `npm run build:phrases` 自动用 venv 里的 python。
- **`npm install` 需要网络**；tone-index.json 已在仓库内，不需要 Python 也能跑前端（只要索引文件存在）。
- **tsconfig 严格**，`npm run build` 会跑 `tsc -b`；别塞 `any`。

## 下一步按 ROI 的优先级

**0. 先采第一批数据 + 拿基线**（当前阻塞项）。用户去 `/eval/record` 录 20–30 条
   phrases.txt 里的短语，然后 `/eval/run` 看 Top-5 / 声调混淆 / 按字数拆的数。
   基线出来之前，下面 1–6 项**不知道谁是瓶颈**，所有选型都是凭感觉。

跑完基线之后，按以下 ROI 排序挑最大瓶颈动手（用户确认再动）：

1. **上下文 + LLM rerank**（最大杠杆）。把候选 Top-20 + 上下文扔给 Claude/Gemini 选，主要收益来源。
2. **候选排序加 n-gram LM**（KenLM WASM 或本地 trigram JSON）。纯词频太弱。
3. **声调 Top-2 探索**的节奏惩罚 / 奖励调参。
4. **声调分类换 CNN**。需要自录数据，~数百条。
5. **Streaming / 边哼边出候选**（架构改动大，等前面都做完）。
6. **实现旁路多模态 LLM**（对比用、或作为 fallback）。

每一步都应先读对应 `docs/stages/*.md` 里的"升级路径"，再动。每次改完跑一次
`/eval/run` 对比上次 results JSON，别凭感觉说"这次改好了"。

## 工作流约定

- **改代码前**：读对应 stage 的文档，确认在和哪条升级路径对齐。
- **改决策前**：先和用户对齐，然后改 `docs/mvp-plan.md` 或对应文档，再动代码。
- **提交**：文档一个 commit，代码一个 commit。Commit 消息写 "why"。
- **推送**：分支 `claude/humming-input-method-vU28Z`，`git push origin <branch>`。每次有意义的 commit 完成后自己推，不用问。远端是 SSH (`git@github.com:iamGeoWat/DictateHmm.git`)。
- **PR**：要不要建 PR 自己判断。在 `claude/humming-input-method-vU28Z` 分支上开子分支做大改动再 PR 合回来是 OK 的路径，但没有硬要求；直推主分支也可以。
- **不主动 force push**、**不提交 node_modules / dist**。
- **评测集**：工具在 `eval/`（见 `eval/README.md`）。录音走 `/eval/record`（Chrome/Edge），指标走 `/eval/run`。目前还没有正式的第一批数据。

## 分支和 Git 状态

- 主开发分支：`claude/humming-input-method-vU28Z`
- 远端：SSH `git@github.com:iamGeoWat/DictateHmm.git`
- 最近几次 commit（顶为最新）：
  1. `fix(segment): adaptive silence threshold + live level meter on record page`
  2. `docs(CLAUDE.md): relax push/PR autonomy, update eval pointer`
  3. eval harness 9 个 task commits（`feat(eval): ...`）+ spec + plan
