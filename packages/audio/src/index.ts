/**
 * Audio pipeline primitives shared by the inference worker and main thread.
 *
 * Planned modules (implemented in M2/M3 per ROADMAP.md — intentionally absent
 * now to avoid speculative code):
 *  - TextSegmenter: paragraph/sentence chunking within model token budgets
 *  - PauseInserter: configurable silence between paragraphs/sentences
 *  - Concatenator: single-sample-rate float32 timeline assembly
 *  - WavEncoder: PCM16 WAV export
 */

/**
 * Canonical output sample rate for the assembled timeline (Hz).
 * Kokoro-82M emits 24 kHz mono; all chunks are generated at this rate and the
 * concatenator assumes it. A future provider with a different native rate must
 * resample before contributing audio.
 */
export const TARGET_SAMPLE_RATE_HZ = 24_000;
