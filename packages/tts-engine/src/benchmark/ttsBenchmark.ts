/**
 * Real local TTS benchmark (ROADMAP.md M3, ARCHITECTURE.md §4.3).
 *
 * Loads the selected provider (or reuses an already-loaded model), generates a
 * fixed short sentence, and measures wall-clock initialization and generation
 * time plus produced audio duration. Everything is derived from REAL work on
 * THIS device — no synthetic scores, no hardware assumptions.
 *
 * Definitions (lower RTF is faster):
 *   rtf             = generation_time / generated_audio_duration   (0.5 → half of real time)
 *   speedMultiplier = generated_audio_duration / generation_time   (2.0 → "2× real time")
 *   estimatedTime   = target_audio_duration × rtf                  (see estimation.ts)
 *
 * Resources: when the benchmark loads its own model it releases it in all
 * paths; when handed an existing model it leaves ownership untouched.
 */

import type { LoadedModel, TTSModelProvider, TtsErrorCode } from "../index.js";
import { isTtsError } from "../errors.js";
import type { KokoroDevice } from "../providers/kokoro/config.js";
import { DEFAULT_SPEED, DEFAULT_VOICE_ID } from "@tts/shared";

/**
 * Bump when benchmark methodology changes in a way that makes old cached
 * numbers incomparable (sentence, voice, timing policy…). Consumers must not
 * hard-code this value.
 */
export const BENCHMARK_VERSION = 1;

/** Fixed sentence: phonemizer-friendly, neutral English, stable duration. */
export const BENCHMARK_SENTENCE = "The quick brown fox jumps over the lazy dog.";

export interface BenchmarkConfig {
  modelId: string;
  dtype: string;
}

export interface SuccessfulBenchmark {
  ok: true;
  /** Runtime actually used for the measured generation. */
  runtimeUsed: KokoroDevice | null;
  /** Wall-clock model load/initialization; 0 when a loaded model was reused. */
  initMs: number;
  generationMs: number;
  audioDurationSec: number;
  rtf: number;
  speedMultiplier: number;
  reusedLoadedModel: boolean;
}

export interface FailedBenchmark {
  ok: false;
  stage: "init" | "generation";
  code: TtsErrorCode;
  message: string;
}

export type BenchmarkOutcome = SuccessfulBenchmark | FailedBenchmark;

export interface RunBenchmarkOptions {
  provider: TTSModelProvider;
  /**
   * Reuse this loaded model instead of loading anew. It will NOT be released
   * by the benchmark — the owner keeps control.
   */
  model?: LoadedModel | null | undefined;
  config: BenchmarkConfig;
  sentence?: string | undefined;
  voiceId?: string | undefined;
  speed?: number | undefined;
  /** Monotonic-ish clock injection for tests. Defaults to performance.now/Date.now. */
  now?: (() => number) | undefined;
  /** Abort hook forwarded to load/generate where supported. */
  signal?: AbortSignal | undefined;
}

function defaultClock(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export async function runTtsBenchmark(options: RunBenchmarkOptions): Promise<BenchmarkOutcome> {
  const now = options.now ?? defaultClock;
  const sentence = options.sentence ?? BENCHMARK_SENTENCE;
  const voiceId = options.voiceId ?? DEFAULT_VOICE_ID;
  const speed = options.speed ?? DEFAULT_SPEED;

  let model = options.model ?? null;
  const reusedLoadedModel = model !== null;
  let runtimeUsed: KokoroDevice | null = model?.activeDevice ?? null;

  try {
    let initMs = 0;
    if (!model) {
      const initStart = now();
      model = await options.provider.load({
        onProgress: () => {},
        ...(options.signal ? { signal: options.signal } : {}),
      });
      initMs = Math.max(0, now() - initStart);
      runtimeUsed = model.activeDevice ?? null;
    }

    const generationStart = now();
    try {
      const result = await model.generate({ text: sentence, voiceId, speed });

      const generationMs = Math.max(0, now() - generationStart);
      if (!runtimeUsed) runtimeUsed = model.activeDevice ?? null;

      const audioDurationSec = result.sampleRateHz > 0 ? result.pcm.length / result.sampleRateHz : NaN;
      if (!finitePositive(audioDurationSec) || !finitePositive(generationMs)) {
        return {
          ok: false,
          stage: "generation",
          code: "generation-failed",
          message: "The benchmark run did not produce measurable audio.",
        };
      }

      return {
        ok: true,
        runtimeUsed,
        initMs,
        generationMs,
        audioDurationSec,
        rtf: generationMs / 1000 / audioDurationSec,
        speedMultiplier: audioDurationSec / (generationMs / 1000),
        reusedLoadedModel,
      };
    } finally {
      // Release ONLY resources we created ourselves.
      if (!reusedLoadedModel) {
        await model.release().catch(() => {});
      }
    }
  } catch (error) {
    const stage: "init" | "generation" = reusedLoadedModel ? "generation" : "init";
    if (isTtsError(error)) {
      return { ok: false, stage, code: error.code, message: error.message };
    }
    return {
      ok: false,
      stage,
      code: stage === "init" ? "model-load-failed" : "generation-failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
