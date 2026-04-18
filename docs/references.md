# 参考文献与开源项目

所有链接截止 2025-2026 年调研。失效请 PR 修订。

## Audio Capture

- [MDN: AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
- [MDN: MediaDevices.getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [RNNoise](https://github.com/xiph/rnnoise) — 神经降噪，GPL/BSD
- [Oboe (Android)](https://github.com/google/oboe)

## Pitch Extraction

- [pitchy](https://github.com/ianprime0509/pitchy) — MPM JS/TS，MIT
- [pitchfinder](https://github.com/peterkhayes/pitchfinder) — YIN/AMDF JS 工具箱，MIT
- [pitch-detection (pitchlite)](https://github.com/sevagh/pitch-detection) — MPM/YIN WASM
- [CREPE](https://github.com/marl/crepe) — 2018 CNN F0
- [PESTO](https://github.com/SonyCSLParis/pesto) — 2025 SOTA，[arXiv 2508.01488](https://arxiv.org/abs/2508.01488)
- [ETRI 边缘 F0 2025](https://onlinelibrary.wiley.com/doi/abs/10.4218/etrij.2023-0430)
- [Essentia.js](https://essentia.upf.edu/)（AGPL ⚠️）

## Segmentation & VAD

- [@ricky0123/vad-web](https://github.com/ricky0123/vad) — Silero VAD 的浏览器封装
- [Silero VAD](https://github.com/snakers4/silero-vad) — v5 ONNX
- [TEN-VAD](https://huggingface.co/TEN-framework/ten-vad) — 2025
- [Essentia onset detection](https://essentia.upf.edu/tutorial_rhythm_onsetdetection.html)
- [Meyda](https://meyda.js.org/) — JS 音频特征
- [Picovoice 2025 VAD 对比](https://picovoice.ai/blog/best-voice-activity-detection-vad-2025/)

## Tone Classification

- [ToneNet (Gao et al., 2019)](https://www.researchgate.net/publication/335829403_ToneNet_A_CNN_Model_of_Tone_Classification_of_Mandarin_Chinese)
- [alicex2020/Mandarin-Tone-Classification](https://github.com/alicex2020/Mandarin-Tone-Classification)
- [ML for Mandarin Tone 系统综述 (Preprints Oct 2025)](https://www.preprints.org/manuscript/202510.2478)
- [Transformer on Tone Contours (JASA 2024)](https://pubs.aip.org/asa/jasa/article/156/5/3353/3320989)
- [Unsupervised Mandarin Tone Learning (arXiv 2509.17859)](https://arxiv.org/html/2509.17859v1)
- [Pitch-Aware RNN-T (arXiv 2406.04595)](https://arxiv.org/html/2406.04595v1)
- [Tone Production in Whispered Mandarin](https://www.researchgate.net/publication/259716393_Tone_production_in_whispered_Mandarin)

## Datasets

- [AISHELL-1](https://www.openslr.org/33/) — 170 h，400 speakers
- [AISHELL-3](https://huggingface.co/datasets/AISHELL/AISHELL-3) — 多说话人 TTS
- [THCHS-30](https://www.openslr.org/18/) — Tsinghua 30 h
- [KeSpeech (NeurIPS 2021)](https://datasets-benchmarks-proceedings.neurips.cc/paper/2021/file/0336dcbab05b9d5ad24f4333c7658a0e-Paper-round2.pdf) — 8 方言变体
- [Montreal Forced Aligner](https://montreal-forced-aligner.readthedocs.io/) — 强制对齐，切孤立声调用

## Chinese IME & Candidate Matching

- [librime](https://github.com/rime/librime) — Rime 核心
- [libpinyin](https://github.com/libpinyin/libpinyin)
- [sunpinyin](https://github.com/sunpinyin/sunpinyin)
- [jieba](https://github.com/fxsjy/jieba) — 中文分词
- [python-pinyin](https://github.com/mozillazg/python-pinyin) — 字/词 → 带调拼音
- [THUOCL](https://github.com/thunlp/THUOCL) — 清华分类词表
- [CC-CEDICT](https://cc-cedict.org/wiki/)
- [CLUECorpus2020 (arXiv 2003.01355)](https://arxiv.org/abs/2003.01355)
- [KenLM](https://github.com/kpu/kenlm) — n-gram LM，Apache
- [CHIME (IJCAI 2011)](https://ics.uci.edu/~chenli/pub/ijcai11-chime.pdf) — 容错拼音 IME

## On-device LLMs

- [web-llm](https://github.com/mlc-ai/web-llm) — WebGPU，[论文](https://arxiv.org/html/2412.15803v2)
- [wllama](https://github.com/ngxson/wllama) — llama.cpp WASM
- [transformers.js](https://github.com/huggingface/transformers.js) — ONNX Runtime Web
- [Qwen2.5-0.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct)
- [Qwen3 系列](https://huggingface.co/Qwen)
- [MiniCPM](https://github.com/OpenBMB/MiniCPM)
- [On-device Qwen2.5 评测 (arXiv 2504.17376)](https://arxiv.org/html/2504.17376v1)

## Multimodal LLM

- [Gemini API](https://ai.google.dev/gemini-api/docs/models)
- [Gemini 价格](https://ai.google.dev/gemini-api/docs/pricing)
- [GPT-4o audio](https://platform.openai.com/docs/guides/audio)
- [Qwen3-Omni](https://github.com/QwenLM/Qwen3-Omni) — [技术报告 arXiv 2509.17765](https://arxiv.org/abs/2509.17765)
- [Qwen2.5-Omni](https://github.com/QwenLM/Qwen2.5-Omni)

## Prior Art (Humming / Query-by-Humming)

- Ghias et al. 1995 — 最早的 QbH 系统（音乐检索）
- [Novel Tonal Feature QbH](https://www.researchgate.net/publication/220586762_Novel_Tonal_Feature_and_Statistical_User_Modeling_for_Query-by-Humming) — 用声调特征做中文旋律检索
- [Pitch Extraction for Chinese Humming (Atlantis Press 2016)](https://www.atlantis-press.com/proceedings/cset-16/25859279)
- [QbSH Deep Learning 2017](https://www.ripublication.com/ijaer17/ijaerv12n13_26.pdf)

**没有发现**公开发表的"哼哼 → 中文字符 IME"系统。本项目是此方向的早期尝试。

## 相关语言学

- Whistled speech / Silbo Gomero（证明声调可独立于共振峰传递信息）
- 普通话耳语研究（PMC7127911）— 证明无 F0 时声调仍可通过时长/强度恢复，但不适用于哼哼场景
