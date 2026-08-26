/**
 * PCM16 WAV encoder for single-sample-rate mono float32 audio.
 *
 * Pure function over typed arrays — no DOM APIs — so it runs inside the
 * inference worker, on the main thread, and in Node tests. This is the only
 * WAV encoder in the workspace (one source of truth); kokoro-js output is
 * re-encoded through this module rather than its own utilities.
 */

/** RIFF chunk id + WAVE form size before the data chunk (canonical 44-byte header). */
export const WAV_HEADER_BYTES = 44;

export const WAV_MIME_TYPE = "audio/wav";

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Encode mono float32 PCM (-1..1) as a 16-bit little-endian WAV byte stream.
 * Samples are clamped to [-1, 1]. Throws on invalid sample rates.
 */
export function encodeWavPcm16(pcm: Float32Array, sampleRateHz: number): Uint8Array {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new Error(`Invalid WAV sample rate: ${sampleRateHz}`);
  }

  const dataLength = pcm.length * 2;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * 2, true); // byte rate = rate * block align
  view.setUint16(32, 2, true); // block align (bytes per frame)
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = WAV_HEADER_BYTES;
  for (let i = 0; i < pcm.length; i += 1) {
    const sample = pcm[i]!;
    const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/** Total encoded size in bytes for a given sample count (header included). */
export function wavByteLength(sampleCount: number): number {
  return WAV_HEADER_BYTES + sampleCount * 2;
}
