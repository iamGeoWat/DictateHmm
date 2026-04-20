import { describe, it, expect } from 'vitest';
import { encodeWav } from './wav';

describe('encodeWav', () => {
  it('writes a valid RIFF/WAVE header for mono 16-bit PCM', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const wav = encodeWav(samples, 16000);

    const td = new TextDecoder('ascii');
    expect(td.decode(wav.slice(0, 4))).toBe('RIFF');
    expect(td.decode(wav.slice(8, 12))).toBe('WAVE');
    expect(td.decode(wav.slice(12, 16))).toBe('fmt ');

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(td.decode(wav.slice(36, 40))).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it('round-trips samples within 16-bit quantization error', () => {
    const samples = new Float32Array(100);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 0.1) * 0.8;
    const wav = encodeWav(samples, 16000);

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    for (let i = 0; i < samples.length; i++) {
      const int16 = view.getInt16(44 + i * 2, true);
      const decoded = int16 / 32768;
      expect(Math.abs(decoded - samples[i])).toBeLessThan(1 / 32768 + 1e-6);
    }
  });

  it('clips samples outside [-1, 1]', () => {
    const samples = new Float32Array([2, -2, 1.5, -1.5]);
    const wav = encodeWav(samples, 16000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(44 + 2, true)).toBe(-32768);
    expect(view.getInt16(44 + 4, true)).toBe(32767);
    expect(view.getInt16(44 + 6, true)).toBe(-32768);
  });
});
