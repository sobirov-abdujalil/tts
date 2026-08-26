/**
 * Provider abstraction for TTS engines.
 *
 * This package defines the CONTRACT only. Concrete providers (Kokoro local via
 * kokoro-js since M2, cloud/expressive providers in M7) implement these
 * interfaces and register themselves — nothing outside this package may import
 * a concrete provider by name. The UI and router depend on these types alone.
 *
 * Framework-agnostic: no React, no DOM-only APIs. Runs inside a Web Worker,
 * the main thread, and Node test processes.
 */

import type { InferenceEnvironment } from "./env.js";

/** Where inference for a provider executes. */
export type ProviderKind = "local" | "cloud";

/** Static description of a voice offered by a provider (data-driven catalog). */
export interface VoiceDescriptor {
  id: string;
  /** Human-readable name shown in the UI. */
  name: string;
  /** BCP-47-ish language tag, e.g. "en-US". */
  language: string;
  gender?: "male" | "female" | "neutral";
  previewUrl?: string;
}

export interface SpeedRange {
  min: number;
  max: number;
}

/** What a provider can do — used by the router, recommendation card, and UI gating. */
export interface ProviderCapabilities {
  voices: readonly VoiceDescriptor[];
  speedRange: SpeedRange;
  supportsEmotion: boolean;
  maxCharsPerRequest: number;
}

/**
 * Device signals a provider needs before it can be considered.
 * Detection lives in ./env.js (M2 minimal probe; full detection M3).
 */
export interface DeviceRequirements {
  requiresWebGPU?: boolean;
  minCpuCores?: number;
  crossOriginIsolated?: boolean;
}

/** Aggregated device capability report (populated by M3 capability detection). */
export interface DeviceReport {
  webgpuAvailable: boolean;
  cpuCores: number;
  /** Approximate device memory in GB where the browser exposes it (Chromium only). */
  deviceMemoryGB?: number;
  crossOriginIsolated: boolean;
  storageQuotaBytes?: number;
}

export interface EstimateContext {
  charCount: number;
  device: DeviceReport;
}

/** e.g. realtimeFactor 1.8 means generation takes ~1/1.8 of audio duration. */
export interface SpeedEstimate {
  realtimeFactor: number;
}

export interface LoadOptions {
  /** 0..1 progress during model download/load (local providers). */
  onProgress: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Mono PCM result at the provider's native sample rate. */
export interface AudioResult {
  sampleRateHz: number;
  pcm: Float32Array;
}

export interface SynthesisInput {
  text: string;
  voiceId: string;
  speed?: number;
  /**
   * Aborting stops work promptly. For local single-chunk generation this
   * terminates the inference worker (DECISIONS.md D-015); chunked cooperative
   * abort arrives with long-text support in M3.
   */
  signal?: AbortSignal;
}

/** A loaded, ready-to-generate model instance. One active session at a time. */
export interface LoadedModel {
  generate(input: SynthesisInput): Promise<AudioResult>;
  release(): Promise<void>;
  /**
   * Execution backend actually in use, when the provider exposes one
   * (local providers report "webgpu"/"wasm"); null/undefined otherwise.
   */
  readonly activeDevice?: "webgpu" | "wasm" | null;
}

/**
 * The single seam every TTS engine plugs into.
 * The model router selects among registered providers using capabilities,
 * device report, entitlements, and requested features — never hard-coded ids
 * outside the registry.
 *
 * `isAvailable`/`dispose` are optional hooks added in M2: availability lets
 * callers short-circuit unsupported environments without loading anything,
 * dispose releases resources held before/without load().
 */
export interface TTSModelProvider {
  /** Stable id within the provider registry, e.g. "kokoro-local". */
  id: string;
  kind: ProviderKind;
  capabilities: ProviderCapabilities;
  requirements?: DeviceRequirements;
  /** Best-effort speed estimate; null when the provider cannot estimate. */
  estimate(ctx: EstimateContext): SpeedEstimate | null;
  load(opts: LoadOptions): Promise<LoadedModel>;
  /**
   * Graceful shutdown of any LOADED session (weights + worker), freeing
   * memory while keeping the provider reusable — the next load() starts
   * fresh from cache. Optional; callers must tolerate absence.
   */
  release?(): Promise<void>;
  isAvailable?(env: InferenceEnvironment): boolean;
  dispose?(): void;
}

export type { InferenceEnvironment } from "./env.js";
export { detectInferenceEnvironment, probeWebGPUAdapter } from "./env.js";

// --- Device capability detection (M3) --------------------------------------
export {
  detectDeviceProfile,
  describeDeviceSignature,
  toDeviceReport,
} from "./device/deviceProfile.js";
export type {
  Capability,
  Confidence,
  DeviceProfile,
  DeviceProfileDeps,
  NavigatorLike,
  WebGPUAdapterInfoHint,
} from "./device/deviceProfile.js";

// --- Runtime selection (WebGPU vs WASM) -------------------------------------
export { describeActiveRuntime, selectLocalRuntimePlan } from "./runtime/runtimeSelection.js";
export type { RuntimeSelectionOptions, RuntimeSelectionPlan, WebGPURuntimeState } from "./runtime/runtimeSelection.js";

// --- Real TTS benchmark + local-only cache ----------------------------------
export { runTtsBenchmark, BENCHMARK_SENTENCE, BENCHMARK_VERSION } from "./benchmark/ttsBenchmark.js";
export type {
  BenchmarkConfig,
  BenchmarkOutcome,
  FailedBenchmark,
  RunBenchmarkOptions,
  SuccessfulBenchmark,
} from "./benchmark/ttsBenchmark.js";
export {
  BENCHMARK_CACHE_KEY,
  BENCHMARK_MAX_AGE_MS,
  BenchmarkCache,
  getDefaultBenchmarkCache,
  localStorageStore,
  readStoredDeviceSignature,
  writeStoredDeviceSignature,
} from "./benchmark/benchmarkCache.js";
export type { CachedBenchmark, KeyValueStore } from "./benchmark/benchmarkCache.js";

// --- Model descriptors + recommendation -------------------------------------
export {
  KOKORO_Q8_DESCRIPTOR,
  getModelDescriptor,
  listModels,
  registerModel,
} from "./recommend/models.js";
export type { ModelDescriptor, ModelMinRequirements, QualityCategory } from "./recommend/models.js";
export { recommendModels } from "./recommend/recommend.js";
export type { Recommendation, RecommendInput, UserIntent, UserRequirements } from "./recommend/recommend.js";
export {
  estimateGenerationSeconds,
  formatDuration,
  formatSpeedMultiplier,
  isValidRtf,
} from "./recommend/estimation.js";

// --- Download tracking / corrupted-cache recovery ----------------------------
export {
  DOWNLOAD_RECORD_KEY,
  readDownloadRecord,
  writeDownloadRecord,
} from "./cache/downloadTracker.js";
export type { DownloadRecord } from "./cache/downloadTracker.js";

export { TTS_ERROR_CODES, TtsError, classifyRuntimeError, isTtsError } from "./errors.js";
export type { TtsErrorCode } from "./errors.js";
export { getPreferredLocalProvider, getProvider, listProviderIds, registerProvider } from "./registry.js";
export { KokoroLocalProvider } from "./providers/kokoro/kokoroProvider.js";
export type {
  BenchmarkEstimateLookup,
  DownloadRecoveryHooks,
  KokoroProviderOptions,
  WorkerFactory,
  WorkerHandle,
} from "./providers/kokoro/kokoroProvider.js";
export {
  KOKORO_DEFAULT_LOAD_CONFIG,
  KOKORO_DTYPE,
  KOKORO_MODEL_ID,
  KOKORO_SAMPLE_RATE_HZ,
} from "./providers/kokoro/config.js";
export type { KokoroDevice, KokoroDtype, KokoroLoadConfig } from "./providers/kokoro/config.js";
export {
  WORKER_PROTOCOL_VERSION,
  isMainToWorkerMessage,
} from "./providers/kokoro/protocol.js";
export type {
  GenerateRequestPayload,
  LoadRequestPayload,
  MainToWorkerMessage,
  WorkerToMainMessage,
} from "./providers/kokoro/protocol.js";
