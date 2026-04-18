# 环节 2：F0 / 基频提取

## 问题定义

**输入：** PCM 音频（16 kHz mono）。
**输出：** 帧级 F0 序列 `Array<{timeMs, f0Hz, voiced, confidence}>`。
**要求：**
- 帧率 ≥ 100 Hz（每 10 ms 一帧）以捕捉声调曲线细节。
- 在典型人声范围 80–500 Hz 准确，误差 < 5%。
- 浏览器可部署（WASM / JS / WebGPU 之一）。
- 实时：<= 1× 实时因子（处理 1s 音频用时 ≤ 1s）。

## 方案对比

| 方案 | 精度 | 延迟/帧 | 包大小 | 许可证 | 备注 |
|---|---|---|---|---|---|
| **pitchy (MPM)** | 中 | ~1 ms | < 20 KB JS | MIT | MVP 首选，McLeod Pitch Method，Node + 浏览器 |
| pitchfinder (YIN/AMDF) | 中 | ~2 ms | < 50 KB JS | MIT | 多算法工具箱，教学用好 |
| Pitchlite (MPM/YIN WASM) | 中 | < 1 ms | ~300 KB | MIT | 显式实时、sub-chunk |
| essentia.js (PitchYinFFT, PredominantPitchMelodia) | 高 | ~5 ms | ~3 MB WASM | AGPLv3 ⚠️ | 全能但 AGPL，产品注意 |
| CREPE via ONNX Runtime Web | 高 | 10–30 ms | ~2 MB 模型 | MIT | 2018 SOTA，重但稳 |
| **PESTO via ONNX** | **最高** | < 10 ms | **130K 参数** | MIT | 2025 SOTA，ISMIR/TISMIR，SSL + VQT |
| FCNF0++ / penn | 高 | 中 | 中 | — | 学术，部署麻烦 |
| Praat | 高 | — | — | GPL | 桌面研究用 |
| 自相关 / AMDF 手写 | 低-中 | < 1 ms | ~1 KB | 自写 | 纯教学，生产别用 |

### 帧参数常见取值

- 窗长：25–40 ms（400–640 样本 @ 16 kHz）
- 帧移：10 ms（160 样本）
- F0 搜索范围：60–600 Hz（男低到女高）

## MVP 选型

**pitchy（MPM）+ 中值滤波（窗口 5 帧）+ octave error 纠正**

理由：
- pitchy 是纯 JS ~20 KB，调用即用，不需要 WASM 工具链。
- MPM 对清音/浊音判断比 YIN 更干净，哼哼信号几乎全浊音，MPM 很合适。
- 中值滤波能滤掉跳变（octave errors 一般是孤立帧）。

```ts
import { PitchDetector } from 'pitchy';

const detector = PitchDetector.forFloat32Array(frameSize);
const [pitch, clarity] = detector.findPitch(frame, sampleRate);
// pitch=Hz, clarity=0..1
```

## 升级路径

1. **鲁棒性不够**（低音量、气音）→ 换 PESTO ONNX via `onnxruntime-web`（WebGPU EP 加速）。
2. **需要 Python 离线分析/训练**（生成评测/训练数据）→ librosa `pyin`。
3. **嵌入式端侧**（iOS Core ML / Android NNAPI）→ PESTO / FCNF0++ 移植。

## 数据清洗与后处理

F0 原始输出直接用会有毛刺，必须：

1. **Unvoiced 阈值**：clarity < 0.6 标为 `null`。
2. **Octave 修正**：邻帧 ≈ 2× 或 0.5× 跳变时，取与邻域连续的那个。
3. **中值滤波 / Savitzky-Golay**：窗口 3–5 帧平滑。
4. **Log 变换**：取 `log2(Hz)` 后再做声调分类，因为感知是对数的。
5. **Z-score 归一化**：按"段"（单个哼）内均值/方差归一，消除用户绝对音高差异。

## 开放问题

- 鼻音共振会让 F0 在哼哼时有轻微抖动，是否需要额外平滑？
- 非常短的哼（< 150 ms）窗长不够，MPM/YIN 可能不稳定；需要自适应窗长？
- 女性/男性音域差异大，是否每用户做一次"音域校准"能显著提升下游？

## 参考

见 [`../references.md`](../references.md) 的 "Pitch Extraction" 区块。
