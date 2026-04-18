# CLAUDE.md — 给接手的你

你接手了一个正在开发中的项目。先读完这份文档，再开始做事。

---

## 一句话项目描述

**DictateHmm**：一个中文哼哼输入法。用户闭嘴哼（只传声调+节奏，没有声母韵母），结合上下文，产生候选中文。MVP 阶段，验证可行性。

## 用户是谁、怎么合作

观察到的风格（按该顺序对待）：

1. **先讨论，再执行。** 用户经常问"还有哪些路？"、"这样对吗？"、"先调研再写文档再执行"。**除非用户说"执行"/"做"/"写代码"，否则默认先给方案、权衡、选型供选择**。
2. **技术讨论要结构化。** 用户明确抱怨过"讨论不清晰"。答复涉及多选项时，**列表格**（方案 / 精度 / 延迟 / 依赖 / 许可证），每行一句话。避免散文。
3. **把"懒路径"和"主路径"分开。** 云端 LLM 直出 = 懒路径，纯链路 = 主路径。用户倾向主路径，但保留懒路径做 fallback/对比。**不要偷偷用 LLM 绕过问题。**
4. **中文主，技术名词英文。** 回复中文，API/库/论文名保留英文。
5. **用户会剪范围。** 主动提出"跳过 X"、"压成 2 阶段" 这类剪枝；你应该也主动做同样判断，但**向用户确认后再改计划文档**。
6. **简短回复。** 工具调用之间一两句；最终回复不超过一段。用户不需要过程解说，需要结论 + 去向。
7. **用户信任你的判断，但会抽查结论。** 遇到不对的会直说（例："这些技术路线讨论的不是很清晰"）。别粉饰，别虚张，承认不确定。
8. **提交粒度要对。** 文档一个 commit，代码一个 commit，决策变更一个 commit。消息写"why"不写"what"。
9. **不主动 push/PR/comment GitHub**，除非用户明说。本项目分支是 `claude/humming-input-method-vU28Z`，MVP 已推送过。

## 当前状态

**阶段：** MVP 已实现并推送。用户正在/即将本地试用。**等用户试用反馈**再决定下一步迭代方向。

**重要：** 不要自动启动下一阶段工作。用户说"试完了，下一步做 X" 再动。

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
│   ├── segment/segment.ts     # 能量 + F0 voicing 分段
│   ├── tone/classify.ts       # 规则分类器（log z-score 后 slope/curvature/fMinPos）
│   ├── rhythm/features.ts
│   ├── candidates/match.ts    # beam search over tone × split
│   ├── pipeline.ts            # 编排
│   ├── types.ts               # 环节间接口
│   ├── App.tsx / App.css      # UI
│   └── ui/PitchPlot.tsx
├── public/
│   ├── audio-worklet.js       # AudioWorklet processor（必须独立文件）
│   └── data/tone-index.json   # 构建产物，7 MB，已在仓库
└── scripts/
    └── build_tone_index.py    # jieba dict + pypinyin → tone-index.json
```

## 流水线（必背）

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
| 跳过 Phase 0（LLM 可行性验证） | LLM 成功 ≠ 我们主链路成功；不预测我们的结果，浪费时间 |
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

**注：** `tone-index.json` 已在仓库内（7 MB）。重跑 `build_tone_index.py` 只在改索引逻辑或调参时需要。

## 预期的坑

- **AudioWorklet 必须独立文件**，不能 bundle — 在 `public/audio-worklet.js`。改它别移走。
- **浏览器 AudioContext 采样率不是 16 kHz**（通常 44.1/48）。`resampleTo16k` 在 `src/audio/capture.ts`，F0 前必须重采样。
- **Safari 没测过**，已知 AudioWorklet 有坑。Chrome/Edge 桌面优先。
- **`npm install` 需要网络**；tone-index.json 已在仓库内，不需要 Python 也能跑前端（只要索引文件存在）。
- **tsconfig 严格**，`npm run build` 会跑 `tsc -b`；别塞 `any`。

## 下一步按 ROI 的优先级（来自用户和我的共识）

只有用户确认主动迭代时才动：

1. **上下文 + LLM rerank**（最大杠杆）。把候选 Top-20 + 上下文扔给 Claude/Gemini 选，主要收益来源。
2. **候选排序加 n-gram LM**（KenLM WASM 或本地 trigram JSON）。纯词频太弱。
3. **加入声调 Top-2 探索**的节奏惩罚 / 奖励调参。
4. **声调分类换 CNN**。需要自录数据，~数百条。
5. **Streaming / 边哼边出候选**（架构改动大，等前面都做完）。
6. **实现旁路多模态 LLM**（对比用、或作为 fallback）。

每一步都应先读对应 `docs/stages/*.md` 里的"升级路径"，再动。

## 工作流约定

- **改代码前**：读对应 stage 的文档，确认你在和哪条升级路径对齐。
- **改决策前**：先和用户对齐，然后改 `docs/mvp-plan.md` 或对应文档，再动代码。
- **提交**：文档一个 commit，代码一个 commit。Commit 消息写 "why"。
- **推送**：分支 `claude/humming-input-method-vU28Z`，`git push -u origin <branch>`。
- **不要** 自动创建 PR、不主动 force push、不提交 node_modules / dist。
- **评测集**：还没有。如果用户让你做评测，先建 `eval/datasets/` 放自录音频 + 标注 JSON。

## 分支和 Git 状态

- 主开发分支：`claude/humming-input-method-vU28Z`
- 最近 3 次 commit：
  1. `feat(mvp): runnable humming input method end-to-end`
  2. `docs(mvp-plan): drop LLM feasibility phase, compress to 2 stages`
  3. `docs: initial research and MVP plan for humming input method`

## 最后一点

用户是**产品/工程双栖**，对技术本质有直觉但不会自己写代码。你要：
- 把技术选择的**权衡**讲清楚，让他能做决策
- 主动提**可能错的地方**和**你不确定的地方**
- 别为了显得能干而堆工作量——**裁掉无用环节比做满更受欣赏**

祝接手顺利。
