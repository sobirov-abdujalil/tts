import { describe, expect, it } from "vitest";
import { TARGET_SAMPLE_RATE_HZ } from "./index.js";
import { WAV_HEADER_BYTES, encodeWavPcm16, wavByteLength } from "./wav.js";

function headerOf(bytes: Uint8Array): Record<string, number | string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  return {
    riff: ascii(0, 4),
    wave: ascii(8, 4),
    fmt_: ascii(12, 4),
    data: ascii(36, 4),
    fileSize: view.getUint32(4, true),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRateHz: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataLength: view.getUint32(40, true),
  };
}

describe("encodeWavPcm16", () => {
  it("writes a canonical 44-byte mono PCM16 header", () => {
    const bytes = encodeWavPcm16(new Float32Array([0, 0.5, -0.5]), TARGET_SAMPLE_RATE_HZ);
    expect(bytes.byteLength).toBe(WAV_HEADER_BYTES + 6);
    const h = headerOf(bytes);
    expect(h.riff).toBe("RIFF");
    expect(h.wave).toBe("WAVE");
    expect(h.fmt_).toBe("fmt ");
    expect(h.data).toBe("data");
    expect(h.audioFormat).toBe(1);
    expect(h.channels).toBe(1);
    expect(h.sampleRateHz).toBe(24_000);
    expect(h.byteRate).toBe(48_000);
    expect(h.blockAlign).toBe(2);
    expect(h.bitsPerSample).toBe(16);
    expect(h.dataLength).toBe(6);
    expect(h.fileSize).toBe(WAV_HEADER_BYTES - 8 + 6);
  });

  it("encodes known samples as little-endian PCM16", () => {
    const bytes = encodeWavPcm16(new Float32Array([1, -1, 0]), 8000);
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(44, true)).toBe(32767); // +full scale
    expect(view.getInt16(46, true)).toBe(-32768); // -full scale
    expect(view.getInt16(48, true)).toBe(0);
  });

  it("clamps out-of-range samples", () => {
    const bytes = encodeWavPcm16(new Float32Array([2, -2]), 8000);
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it("produces an empty data chunk for silence-free input", () => {
    const bytes = encodeWavPcm16(new Float32Array([]), TARGET_SAMPLE_RATE_HZ);
    expect(bytes.byteLength).toBe(WAV_HEADER_BYTES);
    expect(headerOf(bytes).dataLength).toBe(0);
  });

  it("rejects invalid sample rates", () => {
    expect(() => encodeWavPcm16(new Float32Array([0]), 0)).toThrow(/sample rate/i);
    expect(() => encodeWavPcm16(new Float32Array([0]), Number.NaN)).toThrow(/sample rate/i);
  });

  it("reports deterministic sizes via wavByteLength", () => {
    expect(wavByteLength(1000)).toBe(WAV_HEADER_BYTES + 2000);
  });
});
