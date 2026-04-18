// Audio worklet processor: collects mono PCM samples into fixed-size frames
// and posts them to the main thread. Also posts rolling RMS for UI feedback.
//
// NOTE: this file lives in public/ so Vite serves it verbatim at /audio-worklet.js.
// AudioWorklet modules must be loaded from a URL, not a bundled module.

class HumProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetFrameSize = opts.frameSize || 1024; // samples per dispatch
    this.buffer = new Float32Array(this.targetFrameSize);
    this.filled = 0;
    this.active = true;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'stop') this.active = false;
    };
  }

  process(inputs) {
    if (!this.active) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    let i = 0;
    while (i < channel.length) {
      const space = this.targetFrameSize - this.filled;
      const take = Math.min(space, channel.length - i);
      this.buffer.set(channel.subarray(i, i + take), this.filled);
      this.filled += take;
      i += take;
      if (this.filled === this.targetFrameSize) {
        // Post a copy so the main thread doesn't race with the next write.
        const frame = new Float32Array(this.buffer);
        let sumSq = 0;
        for (let j = 0; j < frame.length; j++) sumSq += frame[j] * frame[j];
        const rms = Math.sqrt(sumSq / frame.length);
        this.port.postMessage(
          { type: 'frame', samples: frame, sampleRate, rms },
          [frame.buffer]
        );
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('hum-processor', HumProcessor);
