# 环节 6+7：候选生成与排序

## 问题定义

**输入：** 声调序列（+ 每段 Top-2 alt + 节奏特征） + 可选的上下文（聊天历史等）。
**输出：** Top-K 候选中文序列（按可能性排序）。
**难度：** 这是全链路最难的一环。声调序列歧义极高，纯声调 4 字词的候选空间数以万计。

## 信息量再算

- 4 声调的 4 字序列：4⁴ = 256 种。
- 每个声调对应约 80–200 个常用字，4 字组合粗算 `200⁴ ≈ 1.6 × 10⁹`。
- 但实际出现过的 4 字词/短语（语料里）只有 10⁴–10⁵ 量级。
- **结论：强依赖语言模型剪枝，必须用语料频率或 LM。**

## 方案对比

| 方案 | 候选覆盖 | 排序质量 | 延迟 | 依赖 |
|---|---|---|---|---|
| 声调串 → 词典 Trie → 按 unigram 频率排序 | 中 | 差 | < 5 ms | 词频表 |
| **+ n-gram LM（KenLM，浏览器 WASM）+ Viterbi/beam** | 中 | 中 | 10–50 ms | KenLM |
| **+ 节奏先验作分词软约束** | 中 | 中+ | 同上 | 上 + 分词 |
| 本地小 LLM（Qwen 0.5B q4 via WebGPU）rerank top-K | 高 | 高 | 200–800 ms | web-llm |
| 云端 LLM rerank | 高 | 最高 | 300 ms–1.5 s | 网络 |
| 云端 LLM 直接生成（给声调序列 + 上下文） | 高 | 高 | 500 ms–2 s | 网络 |
| 旁路：多模态 LLM 直出（跳过所有前置） | 高 | 高 | 取决于模型 | 网络 + 音频 LLM |

## 数据准备

### 词典与频率

| 资源 | 内容 | 许可证 | 备注 |
|---|---|---|---|
| **jieba 词频表** | 常用词 + 频率 | MIT | 最简单起点 |
| **THUOCL** | 分类词表 | Apache | 领域细分 |
| **SogouW / SogouT** | 大规模词频 + 新闻语料 | 注册 | 需要申请 |
| **CLUECorpus2020** | 100 GB 预训练文本 | CC | 自建 KenLM 用 |
| **CC-CEDICT** | 中英词典（含拼音） | CC | 带调拼音方便 |
| **python-pinyin** | 字/词 → 带调拼音 | MIT | 构建索引用 |

### 构建声调 → 候选索引

离线一次性生成：

```
1. 拉取 CLUECorpus2020 或其他大语料。
2. 用 jieba 分词。
3. 每个词/短语用 python-pinyin 拿带调拼音。
4. 拼音序列 → 声调序列（丢掉声韵母）。
5. 建立 `tone_seq → [(phrase, freq)]` 的倒排索引。
6. 可选：分桶到 ngram=1/2/3/4 分别存（MVP 只做 1/2/3）。
```

**这个索引是产品的核心资产之一。** MVP 可先用 10 万量级的语料快速出版本，产品化阶段再扩到完整语料。

### n-gram LM

- 用 **KenLM**（Apache 2.0）在 CLUECorpus2020 训一个字级或词级 trigram。
- 编译成 WASM（有现成项目），浏览器查询亚毫秒级。
- 也可以先用 Python 训好查询表，存 JSON，前端纯查表。

### 小型 LLM（rerank）

- **Qwen2.5-0.5B-Instruct** 或 **Qwen3 0.6B**（q4f16）via `@mlc-ai/web-llm`。
- 400 MB 左右量化后，WebGPU 加载 5–10 秒，推理 20–60 tok/s。
- Prompt：给 top-K 候选 + 对话上下文，让它 pick 最合理的。

## 候选生成算法（MVP）

```
输入：tones = [t1, t2, ..., tn] （每段 Top-2 alt）
       gaps  = [g1, ..., g_{n-1}]
       context = "最近几条消息文本"

1. 为每段扩展 Top-2 alt，形成 tone 序列的集合（最多 2^n 种，n<=6 时 64 种）。
2. 对每个 tone 序列：
   a. 用分词决策（基于 gaps）枚举几种分词方案（MVP: 1-2 种）。
   b. 对每种分词方案，用倒排索引查每个词的候选列表（各段 top-M, M=20）。
   c. 用 KenLM trigram 做 beam search（beam=50），组合出完整句子。
3. 合并所有 tone 序列的候选，按 LM 得分排序，取 Top-K (K=20)。
4. （可选）把 Top-K + context 送给 LLM 做 rerank，取 Top-5 展示。
```

## MVP 选型

**Phase 1（不用 LLM）：**
- 离线建"声调→词"索引（jieba + python-pinyin on 10M 词语料）。
- KenLM 字级 trigram（WASM）。
- Beam search 生成 Top-20。
- 纯词频排序展示，观察命中率。

**Phase 2（引入 LLM rerank）：**
- 云端 Claude / Gemini rerank Top-20。
- Prompt: "以下是用户哼出来的候选中文（仅声调匹配），结合上下文选最合理的："。
- 计时：排序总延迟不超过 1 s。

**Phase 3（本地化）：**
- 迁移到 `web-llm` + Qwen2.5-0.5B 做本地 rerank，离线可用。

## 延迟预算

| 步骤 | 目标延迟 |
|---|---|
| 索引查询 | < 5 ms |
| Beam search (n=6, beam=50) | < 50 ms |
| LM 打分 | < 10 ms |
| LLM rerank（云端） | 300–800 ms |
| LLM rerank（本地 WebGPU） | 200–600 ms |
| **端到端（Phase 1）** | **< 100 ms** |
| **端到端（Phase 2 云端）** | **< 1 s** |

## 开放问题

- 4+ 字的声调序列候选爆炸，beam=50 够不够？可能要 beam=200。
- 上下文从哪来？聊天输入法可以拿到对话历史，独立 demo 要用户自己输入。
- LLM rerank 的 prompt 是否需要给"带调拼音候选"而不是只有汉字？带调拼音能帮 LLM 验证。
- 用户学习曲线：用户哼多了会不会形成"个人习惯声调"？需要用户级自适应。
- 是否支持用户"纠错反馈"（点错→学习）？产品化重要，MVP 先记录不处理。

## 参考

见 [`../references.md`](../references.md) 的 "Candidate Matching" 区块。
