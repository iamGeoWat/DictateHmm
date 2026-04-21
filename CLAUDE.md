# CLAUDE.md — DictateHmm 项目接手笔记

## 这个项目是什么

一个中文"哼哼输入法"的早期原型。用户闭着嘴哼几声，每个字之间停一下，
浏览器端提取每一段的基频曲线，判断是第几声，再拿这串声调去一个事先
建好的"声调序列 → 常用词"索引里搜候选中文词。

核心假设是：哼声里基本只稳定传递了声调和节奏，声母韵母都没了。因此
输入信号比普通拼音输入法弱得多，必须重度依赖词频先验（以及未来的
上下文 / LLM 重排）才可能把候选筛到可用。

这是可行性验证级别的 MVP，不是面向用户的产品。

## 现在实际状态（比之前的文档更诚实一点）

代码层面 pipeline 的七个模块全部已经写完：采音、F0 提取、分段、声调
分类、节奏特征、候选匹配、编排。加上一套评测工具链（录音页、批量跑
页、WAV 编码、指标）。

但是——**"这条链路能跑出有意义的候选"这件事，目前没有数据证据**。
具体讲：

- `eval/results/` 里唯一一次跑是 `2026-04-21T21-50-35.json`，4 条录音，
  Top-K 全是 0，所有样本的 `segmentCountMismatchRate` 是 100%，也就是
  一段都没能分出来。
- 那次跑用的 git sha 是 `fa518ce`，之后才有 `fix(segment): adaptive
  silence threshold` 这个修复。之前分段用的是绝对 -45 dBFS 阈值，
  Safari 上录出来的信号根本过不了门槛。
- `eval/datasets/recordings/` 目录现在是空的——当时录的那 4 条 wav
  没留下来（可能是 gitignore 漏配或者之后被清理了）。

换句话说：修分段的那次 commit 之后，还没有人重新录过一批、重新跑过
evaluator。所以下一步真正该做的事是——

**重新录一批，比如 20–30 条 `eval/datasets/phrases.txt` 里的短语，
在 `/eval/run` 里跑一次，拿到第一份可信的基线数字。** 在这之前，
所有"下一步改哪里最有收益"的讨论都是凭感觉。

还有几处文档 / 代码状态不一致：
- `README.md` 和 `eval/README.md` 里还留着"Safari 因为 -45 dB 阈值
  录不到"的旧说法，没跟 segment.ts 的修改同步。
- 之前版本的本项目 CLAUDE.md 把状态写成"链路已跑通"，给人"代码写完
  = 能工作"的错觉。实际上只能说"代码结构完成，但未经真实数据验证"。

## 怎么跑起来

```bash
npm install

# 下载 jieba 词典
curl -L -o /tmp/jieba-dict.txt \
  https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt

# 装 pypinyin（系统 Python 装不了的话用 eval/.venv）
python3 -m pip install pypinyin

# 构建声调 → 词候选索引（产物 ~7 MB）
python3 scripts/build_tone_index.py

# 启动 dev server
npm run dev
```

页面:
- `http://localhost:5173/` —— 主输入法界面
- `http://localhost:5173/eval/record` —— 评测录音
- `http://localhost:5173/eval/run` —— 批量跑评测

`public/data/tone-index.json` 已经在仓库里了，不重跑 `build_tone_index.py`
也能直接启前端。只有改了索引逻辑或者调了索引里的参数（比如 MIN_FREQ）
才要重跑。

注意：`/__eval/*` 这些写盘端点是 `scripts/vite-plugin-eval-io.ts` 这个
dev-only 插件注入的，只在 `npm run dev` 下生效。`npm run preview` 或者
生产构建里不会有，这时候打开 `/eval/record` 或 `/eval/run` 看起来页面
能打开，但所有 API 会 404。

## 代码分布

```
src/
├── audio/capture.ts       getUserMedia + AudioWorklet，原始采样率 Float32
├── pitch/extract.ts       pitchy (MPM) 逐帧 F0 + 中值滤波 + octave 修正
├── segment/segment.ts     自适应能量阈值 + ≥150 ms 静音切分
├── tone/classify.ts       规则分类（log + z-score 后看 slope / curvature / fMin 位置）
├── rhythm/features.ts     时长、间隔、能量、分词先验
├── candidates/match.ts    beam search over 分词 × 声调，按词频打分
├── pipeline.ts            把上面串成一条
├── types.ts               各环节接口
└── eval/                  评测工具（录音页、跑评测页、指标、WAV 编码）

public/
├── audio-worklet.js       Worklet processor，必须是独立文件，不能 bundle
└── data/tone-index.json   构建产物

scripts/
├── build_tone_index.py    jieba dict + pypinyin → tone-index.json
├── build_phrases.py       phrases.txt → phrases.json
└── vite-plugin-eval-io.ts dev-only 写盘端点

eval/
├── datasets/phrases.txt       25 条评测脚本
├── datasets/phrases.json      编译产物
├── datasets/recordings/       录音 wav（当前为空）
└── results/*.json             评测跑的结果（.gitignore）

docs/
├── overview.md                问题定义、术语、成功标准
├── architecture.md            流水线、接口、降级策略
├── mvp-plan.md                两阶段执行计划
└── stages/*.md                每个环节的方案对比和选型
```

## 几点架构事实

**pipeline 是一条纯函数链**：输入原始 Float32 + sampleRate + tone index，
输出 `PipelineResult`。每一环的输入输出都写在 `src/types.ts` 里，可以
独立测、独立替换。这是项目骨架里做得比较健康的部分。

**声调分类器是写死的规则**，没有训练模型。给每个声调算一个 score——
- tone 1 看 slope 小、curvature 小（gauss × gauss）
- tone 2 看 slope 正大（sigmoid）
- tone 4 看 slope 负大（sigmoid）
- tone 3 看 fMin 是否在中段 + 比端点低很多，或者全段偏低且平（half-third）
- tone 5（轻声）硬编码：短段 0.3，长段 0.05

再把这些 score `v / sum` 归一化叫做 "confidence"。这里要留意：tone 1 的
score 是 [0,1] 的概率乘积、tone 2/4 是 sigmoid 输出、tone 3 是两种
启发式取 max、tone 5 是常数。**这些东西量纲不同**，归一化之后的
`toneConfidence` 只能在同一段内看大小排序，跨段之间比较会误导。

**候选匹配是 beam search**，宽度 200。对每一种可能的分词（1 到 6 字
一组）枚举，在 tone-index 里按词频对数加分，对节奏先验给出的分词
边界给 bonus（命中 +0.8 log，不命中 -0.4 log）。MVP 阶段故意没上
n-gram LM，也没有 LLM 重排。

**旁路多模态 LLM** 那条路线文档里有（`docs/stages/bypass-multimodal.md`），
代码没实现。保留作为 fallback 设计。

## 我读完代码的几个顾虑（不是本地文档原本就写的）

这些单独列，因为它们是我作为第三方读完之后注意到的，值得未来接手的
人心里有个数：

**核心三个模块没有单元测试**。目前有 test 的只有 `segment.test.ts`、
`wav.test.ts`、`metrics.test.ts`——都是 utility 层的代码。真正决定
项目成败的 `tone/classify.ts`、`candidates/match.ts`、`pitch/extract.ts`
一个都没测。未来调规则参数的时候会很容易"看着好像变好了"，建议等
第一批真实录音回来之后，先把几条能稳定跑对的 case 固化成 golden test。

**`toneConfidence` 的可信度问题** 前面讲过了，tone 5 那个硬编码尤其粗糙。
够用来排序，但不能当作真的概率。

**`altToneSeqs` 目前没有被消费**。`pipeline.ts` 构造了一个
`altToneSeqs: ToneLabel[][]`（每个位置换成第二候选声调得到的序列），
但 `matchCandidates` 内部自己处理 Top-2（在 beam 里给替代声调
-0.36 log 的 penalty），并不读外面传进来的 `altToneSeqs`。所以那个字段
现在唯一的作用是给 debug UI 展示。可以考虑收敛一下接口。

**几个关键常数是第一猜的值**：`ALT_TONE_PENALTY=0.7`（log ≈ -0.36）、
`BOUNDARY_MATCH_BONUS=0.8`、`BEAM_WIDTH=200`、`MIN_GAP_FRAMES=15`。
尤其 boundary bonus (0.8 log) 的绝对值是 alt tone penalty (0.36 log)
的两倍多——意味着"节奏提示的分词边界"对最终候选的影响比"换一个
声调"大一倍。这个取舍对不对，要真实数据说话。

**`README.md` 和 `eval/README.md` 里关于 Safari / `-45 dB` 阈值的
段落过时了**。下一次触碰 eval 文档的时候顺手改掉。

## 关键决策和理由

为什么选这个、没选别的：

- **浏览器 MVP，不做原生**：单平台最快验证，iOS / Android IME 集成不在
  MVP 范围。
- **pitchy (MPM) 而不是 CREPE / PESTO**：20 KB 纯 JS，没深度学习依赖，
  MVP 阶段够用。鲁棒性不够再换。
- **规则声调分类而不是 CNN**：MVP 阶段还没有训练数据。Top-2 兜底
  交给候选层。等自录数据攒够再训。
- **强制字间 ≥ 150 ms 停顿**：哼哼没有辅音 onset，常规 VAD 不工作。
  让用户配合是最简单可靠的方案——代价是用户要练习稳定停顿。
- **纯词频排序，不上 LM**：先跑通、看基线差多少、再决定要补什么。
- **声调索引来自 jieba dict.txt**：公开、免费、349K 词；建索引时
  `MIN_FREQ=3`、`TOP_PER_SEQ=1500`。
- **手加 `BOOST_PHRASES`**：jieba 是新闻 / web 语料，口语高频词（"谢谢"、
  "再见"、"晚安"）词频被低估。这是语料不匹配的症状补丁，不是长期方案。
- **跳过"先验证多模态 LLM 能不能"那一步**：LLM 能识别 ≠ 主链路能达标，
  两条路互不相干，做了等于绕远路。

## 成功 / 失败标准

（从 `docs/overview.md` 抄过来方便查）

MVP 算成功需要同时满足：

1. 安静环境下哼 3–5 字常见短语，目标词在 Top-5 候选里的概率 ≥ 60%。
2. 按下麦克风到出候选，端到端 ≤ 1 秒。
3. 3 位以上没参与开发的人，10 分钟训练后能用它发出一条"有用"的消息。

做不到任何一条就停下来复盘，不强推产品化。

我个人对这三条的看法：
- 第 1 条是技术问题，有数据就能量化回答。
- 第 2 条目前 pipeline 单次耗时 ~20 ms（已验证），瓶颈在用户停顿
  不在代码。
- 第 3 条是最难的。让一个人 10 分钟内学会稳定分声调 + 准确停顿，
  本质是 UX / 学习曲线问题，不是算法问题。

## 下一步的事（按我的看法排序）

我不完全同意之前本文档里"LLM rerank 优先级最高"的排法，理由在最后
一段。按"先拿数据、再决定改哪里"的次序：

1. **先重新录 20–30 条，跑一次 `/eval/run`，拿基线数字。** 在这之前
   所有"改哪里最有收益"的讨论都是凭感觉。
2. 基线出来之后，优先看三个数字：
   - **段数错误率**：如果高，说明分段还是有问题，继续调 segmentation，
     这时候动别的都白费。
   - **按位置声调准确率 + 混淆矩阵**：如果段数 OK 但某些声调（尤其
     2 vs 3）混淆严重，去动 `tone/classify.ts` 的规则。
   - **Top-5 命中率 vs Top-5-with-Top-2**：如果拿 Top-2 兜底之后命中率
     明显提升，说明分类器决定第 1 候选的能力弱但排第 2 也能找到正确
     答案——这时候 LLM 重排 / LM 才真正有发挥空间。
3. 把第一批跑得对的 case 固化成 `tone/classify.ts` 的 golden test，
   给未来调规则参数一个参照。
4. 趁手修掉 `README.md` 和 `eval/README.md` 里关于 Safari / `-45 dB`
   的过时段落。

**为什么不同意"LLM rerank 第一优先级"**：LLM 重排的价值天花板取决于
底层给它的 Top-N 候选里有没有正确答案。如果声调分类错了一半，正确
答案根本不在 Top-20 里，LLM 也捞不回来。所以顺序应该是：先把底层
声调准确率量出来 → 如果 Top-2 accuracy 已经 > 70%，这时候加 LM / LLM
重排是大杠杆；如果 Top-2 accuracy < 70%，先修底层。

## 工作流约定

- **改代码前**：对应的 `docs/stages/*.md` 里有方案对比和选型理由，
  先读再改。
- **改设计决策前**：先和用户对齐，再更新 `docs/`，最后才改代码。
- **提交**：文档一个 commit，代码一个 commit；commit message 说
  "why"，不只是 "what"。
- **推送**：分支是 `claude/humming-input-method-vU28Z`。有意义的 commit
  做完就 `git push origin <branch>`，不用每次问。远端是 SSH
  (`git@github.com:iamGeoWat/DictateHmm.git`)。
- **PR**：自己判断要不要开。在这个分支上再开子分支做大改动后 PR
  合回来是可以的路径，直推本分支也可以。
- 不主动 force push，不 commit `node_modules` / `dist`。

## 已知坑

- **AudioWorklet 必须是独立文件**，在 `public/audio-worklet.js`，不能
  被打进 bundle。改的时候别移走。
- **浏览器 AudioContext 的采样率通常是 44.1 或 48 kHz**，不是 16 kHz。
  F0 提取前必须先用 `resampleTo16k`（在 `src/audio/capture.ts`）。
- **Safari 录出来 RMS 偏低**（大概 -60 到 -66 dBFS 级别），AGC 似乎
  没有真的工作。自适应阈值之后能分段，但为了稳定最好离麦克风近一些。
  主要测试平台仍是 Chrome / Edge。
- **pypinyin 装在 `eval/.venv` 里**，不是系统 Python（Homebrew 的
  PEP 668 限制）。`npm run build:phrases` 会自动用 venv 里的 python。
- **tsconfig 严格**，`npm run build` 会跑 `tsc -b`。别塞 `any` 进去
  应付类型错误。

## 分支和 Git 状态

主开发分支 `claude/humming-input-method-vU28Z`，远端是
`git@github.com:iamGeoWat/DictateHmm.git`。

最近几次 commit（新到旧）：
- `c5c4c19` docs: bookkeep eval harness delivery + adaptive segmentation
- `f6c72ba` fix(segment): adaptive silence threshold + live level meter on record page
- `7e155d2` docs(CLAUDE.md): relax push/PR autonomy
- `018b18b` docs(eval): README
- `02dbe78` feat(eval): run page — batch pipeline + metrics rendering + save
