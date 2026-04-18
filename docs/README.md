# DictateHmm 文档

本目录是 DictateHmm 项目的设计与调研文档，面向 MVP 开发与后续产品化。

## 阅读顺序

1. [`overview.md`](./overview.md) — 问题描述、术语表、总体思路
2. [`architecture.md`](./architecture.md) — 流水线总览、各环节职责、数据接口
3. `stages/*.md` — 各环节的方案对比与选型（可独立查阅）
4. [`mvp-plan.md`](./mvp-plan.md) — MVP 具体执行计划
5. [`references.md`](./references.md) — 参考文献、开源项目、数据集

## 环节文档索引

| 环节 | 文档 | 核心问题 |
|---|---|---|
| 音频采集 | [`stages/audio-capture.md`](./stages/audio-capture.md) | 怎么在浏览器/设备上拿到干净的哼哼音频 |
| 基频提取 | [`stages/pitch-extraction.md`](./stages/pitch-extraction.md) | 怎么从音频里提出 F0 曲线 |
| 分段 | [`stages/segmentation.md`](./stages/segmentation.md) | 怎么把连续哼哼切成一个个音节 |
| 声调分类 | [`stages/tone-classification.md`](./stages/tone-classification.md) | 怎么把一段 F0 曲线判成 1/2/3/4 声 |
| 节奏特征 | [`stages/rhythm-features.md`](./stages/rhythm-features.md) | 时长、间隔、重音能贡献什么 |
| 候选匹配 | [`stages/candidate-matching.md`](./stages/candidate-matching.md) | 怎么从声调序列生成中文候选并排序 |
| 旁路：多模态 LLM | [`stages/bypass-multimodal.md`](./stages/bypass-multimodal.md) | 跳过前面所有步骤直接音频→文字 |

## 文档模板

每个 stage 文档统一结构：

1. **问题定义** — 本环节要解决什么、输入输出
2. **方案对比** — 表格列出候选方案及其精度/延迟/集成难度/许可证
3. **MVP 选型** — 为 MVP 选谁、为什么
4. **升级路径** — 产品化阶段的替换顺序
5. **开放问题** — 未解决或需要实验验证的点
6. **参考** — 链接到 `references.md` 的条目

## 文档状态

所有文档写于 MVP 启动前，基于 2025-2026 年调研。动工后请根据实验结果持续修订，尤其是各 stage 的"开放问题"部分。
