/**
 * Model descriptor registry (ROADMAP.md M3 — model recommendation
 * architecture).
 *
 * A ModelDescriptor is the data-only description of a LOCAL model a provider
 * can run: what it is, what it needs, roughly how big it is, and what it can
 * do. The recommendation engine (recommend.ts) consumes descriptors + device
 * profile + cached benchmarks; nothing else in the app hard-codes model
 * facts.
 *
 * Honesty rules: only document sizes/qualities we actually know from the
 * upstream repos and DECISIONS.md D-004. Unknown fields stay null/false —
 * never invented specifications. Adding a future local model (e.g. Piper) is
 * a pure data operation here plus a provider implementation elsewhere.
 */

import { BASIC_VOICES } from "@tts/shared";
import type { KokoroDevice } from "../providers/kokoro/config.js";
import { KOKORO_DTYPE, KOKORO_MODEL_ID, KOKORO_SAMPLE_RATE_HZ } from "../providers/kokoro/config.js";

/** Coarse, user-understandable quality tier — not a benchmark score. */
export type QualityCategory = "draft" | "good" | "high";

export interface ModelMinRequirements {
  /** Local inference requires WebAssembly today. */
  requiresWasm?: boolean;
  /** Minimum logical cores; null/undefined = no enforced floor. */
  minCpuThreads?: number;
  /** e.g. multithreaded-WASM-dependent features could demand isolation. */
  requiresCrossOriginIsolation?: boolean;
}

export interface ModelDescriptor {
  /** Stable descriptor id, e.g. "kokoro-82m-q8". */
  id: string;
  /** Provider registry id that can execute this model (e.g. "kokoro-local"). */
  providerId: string;
  /** Human-facing name ("Kokoro"). */
  displayName: string;
  /** Upstream repository id (e.g. onnx-community/Kokoro-82M-v1.0-ONNX). */
  modelId: string;
  dtype: string;
  executionRuntimes: readonly KokoroDevice[];
  /**
   * Expected download size in bytes when known from upstream; null when not
   * documented. NEVER guess.
   */
  expectedDownloadBytes: number | null;
  sampleRateHz: number;
  qualityCategory: QualityCategory;
  supportsEmotion: boolean;
  supportsVoiceCloning: boolean;
  languages: readonly string[];
  voiceIds: readonly string[];
  minRequirements: ModelMinRequirements;
}

/**
 * Kokoro-82M q8 — the current production local model (D-004).
 * Size ≈ 86 MB per the upstream ONNX repo / D-004 table.
 */
export const KOKORO_Q8_DESCRIPTOR: ModelDescriptor = {
  id: "kokoro-82m-q8",
  providerId: "kokoro-local",
  displayName: "Kokoro",
  modelId: KOKORO_MODEL_ID,
  dtype: KOKORO_DTYPE,
  executionRuntimes: ["webgpu", "wasm"],
  expectedDownloadBytes: 86 * 1024 * 1024,
  sampleRateHz: KOKORO_SAMPLE_RATE_HZ,
  qualityCategory: "high",
  supportsEmotion: false,
  supportsVoiceCloning: false,
  languages: ["en-US", "en-GB"],
  voiceIds: BASIC_VOICES.map((voice) => voice.id),
  minRequirements: { requiresWasm: true },
};

const models = new Map<string, ModelDescriptor>();

export function registerModel(descriptor: ModelDescriptor): void {
  if (models.has(descriptor.id)) {
    throw new Error(`A model descriptor with id "${descriptor.id}" is already registered.`);
  }
  models.set(descriptor.id, descriptor);
}

export function listModels(): ModelDescriptor[] {
  return [...models.values()];
}

export function getModelDescriptor(id: string): ModelDescriptor | undefined {
  return models.get(id);
}

registerModel(KOKORO_Q8_DESCRIPTOR);
