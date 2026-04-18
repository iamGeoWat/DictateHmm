// Microphone capture via AudioWorklet.
// Emits fixed-size frames at the native sample rate of the AudioContext.

export type CaptureFrame = {
  samples: Float32Array;
  sampleRate: number;
  rms: number;
  timeMs: number;
};

export type CaptureSession = {
  sampleRate: number;
  stop: () => Promise<Float32Array>; // returns concatenated samples
  onFrame: (cb: (frame: CaptureFrame) => void) => void;
};

const FRAME_SIZE = 1024;

export async function startCapture(): Promise<CaptureSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
    },
  });

  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('/audio-worklet.js');

  const source = ctx.createMediaStreamSource(stream);

  // High-pass filter to remove low-frequency rumble (~80 Hz cutoff)
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 80;

  const node = new AudioWorkletNode(ctx, 'hum-processor', {
    processorOptions: { frameSize: FRAME_SIZE },
  });

  source.connect(hp).connect(node);
  // Don't connect to destination - we don't want to play back the mic.

  const t0 = performance.now();
  const frames: CaptureFrame[] = [];
  const frameCallbacks: Array<(f: CaptureFrame) => void> = [];

  node.port.onmessage = (e) => {
    const data = e.data;
    if (data.type !== 'frame') return;
    const frame: CaptureFrame = {
      samples: data.samples,
      sampleRate: data.sampleRate,
      rms: data.rms,
      timeMs: performance.now() - t0,
    };
    frames.push(frame);
    for (const cb of frameCallbacks) cb(frame);
  };

  return {
    sampleRate: ctx.sampleRate,
    onFrame(cb) { frameCallbacks.push(cb); },
    async stop() {
      try { node.port.postMessage({ type: 'stop' }); } catch {}
      try { node.disconnect(); } catch {}
      try { hp.disconnect(); } catch {}
      try { source.disconnect(); } catch {}
      for (const t of stream.getTracks()) t.stop();
      await ctx.close().catch(() => {});

      const total = frames.reduce((n, f) => n + f.samples.length, 0);
      const out = new Float32Array(total);
      let off = 0;
      for (const f of frames) { out.set(f.samples, off); off += f.samples.length; }
      return out;
    },
  };
}

// Downsample to 16 kHz by simple averaging (quality is fine for F0 in 80-500 Hz range).
export function resampleTo16k(samples: Float32Array, srcSampleRate: number): Float32Array {
  const targetSr = 16000;
  if (srcSampleRate === targetSr) return samples;
  const ratio = srcSampleRate / targetSr;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcStart = Math.floor(i * ratio);
    const srcEnd = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = srcStart; j < srcEnd; j++) sum += samples[j];
    out[i] = sum / Math.max(1, srcEnd - srcStart);
  }
  return out;
}
