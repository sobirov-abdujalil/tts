/**
 * Audio pipeline primitives shared by the inference worker and main thread.
 *
 * Implemented: WavEncoder (PCM16 mono export).
 * Planned (M3 per ROADMAP.md): TextSegmenter, PauseInserter, Concatenator.
 */

export * from "./wav.js";

/**
 * Canonical output sample rate for the assembled timeline (Hz).
 * Kokoro-82M emits 24 kHz mono; all chunks are generated at this rate and the
 * concatenator assumes it. A future provider with a different native rate must
 * resample before contributing audio.
 */
export const TARGET_SAMPLE_RATE_HZ = 24_000;
