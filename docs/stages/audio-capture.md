# 环节 1：音频采集

## 问题定义

**输入：** 麦克风。
**输出：** 16 kHz mono PCM（`Float32Array`）流或块。
**要求：**
- 采样率足以覆盖人声基频（约 80–400 Hz，女性更高）——16 kHz 绰绰有余。
- 低延迟（< 20 ms buffer）足够 streaming 场景。
- 尽量抑制低频噪声（空调、桌面震动）和高频嗡鸣。

## 方案对比

| 方案 | 平台 | 延迟 | 集成难度 | 备注 |
|---|---|---|---|---|
| **Web Audio `AudioWorkletNode`** | 浏览器 | ~10 ms | 中 | 推荐。独立线程，块大小可控，streaming 友好 |
| `MediaRecorder` | 浏览器 | 取决于 chunk | 低 | 简单，batch 录一段一扔，适合纯 MVP |
| `getUserMedia` + `ScriptProcessorNode` | 浏览器 | ~20 ms | 低 | 已废弃（仍可用），跑主线程会卡 UI |
| `AVAudioEngine` | iOS 原生 | < 5 ms | 中 | 产品化阶段用 |
| `AAudio` / `Oboe` | Android 原生 | < 10 ms | 中 | 产品化阶段用 |
| Tauri / Electron + `cpal` 等 | 桌面应用 | < 10 ms | 中 | 如果做桌面输入法 |

### 预处理方案

| 方案 | 作用 | 集成 |
|---|---|---|
| 高通滤波（cutoff ~60–80 Hz） | 去低频嗡鸣、桌面震动 | BiquadFilterNode 一行搞定 |
| `RNNoise` WASM | 神经降噪 | 中等复杂度，效果显著 |
| WebRTC `NoiseSuppression` | `getUserMedia` `audioConstraints` | 一个 flag，效果一般 |
| 归一化（AGC） | 均衡用户音量 | WebRTC AGC 或自写 |
| `echoCancellation: false` | **关闭**回声消除 | 哼不是对话，开了反而伤音高 |
| `noiseSuppression: false` | **关闭**默认降噪 | 有些实现会乱调 F0 |

**推荐约束：**
```js
navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    sampleRate: 16000,   // 浏览器不一定听，后面重采样
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: true,  // 可关可开，看实测
  }
});
```
WebRTC 默认的 `noiseSuppression`/`echoCancellation` 对纯音哼哼可能有副作用，先关掉手动加。

## MVP 选型

**AudioWorkletNode + 16 kHz mono + BiquadFilter 高通（80 Hz） + 手动 AGC（归一化 RMS）**

理由：
- AudioWorklet 块大小自定义（128/256/512 样本），与 F0 提取帧对齐容易。
- 不上 RNNoise：增加 ~1 MB 包体积和延迟，MVP 安静环境够用。
- 关闭 WebRTC 的 NS/AEC，防止 F0 被篡改。

## 升级路径

1. **嘈杂环境**：加 RNNoise WASM。
2. **iOS 产品化**：迁到 AVAudioEngine，输入法扩展（Keyboard Extension）需要特殊权限。
3. **Android 产品化**：Oboe + InputMethodService。
4. **延迟敏感**：Worklet chunk 降到 128，流式送往 F0。

## 开放问题

- 浏览器真实采样率不保证 16 kHz，AudioContext 可能返回 44.1/48 kHz，需要在 Worklet 内做重采样（简单多相滤波即可）。
- iOS Safari 对 AudioWorklet 支持历来有坑，需要在真机上验证。
- 输入法场景下用户可能贴近麦克风低声哼，动态范围极小，AGC 策略需要实验。

## 参考

见 [`../references.md`](../references.md) 的 "Audio Capture" 区块。
