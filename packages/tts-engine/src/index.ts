/**
 * Provider abstraction for TTS engines.
 *
 * This package defines the CONTRACT only. Concrete providers (Kokoro local via
 * kokoro-js in M2, cloud/expressive providers in M7) implement these interfaces
 * and register themselves — nothing outside this package may import a concrete
 * provider by name. The UI and router depend on these types alone.
 *
 * Framework-agnostic: no React, no DOM-only APIs. Runs inside a Web Worker,
 * the main thread, and Node test processes.
 */

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
 * Detection itself lives in a separate module (M3); this describes requirements.
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
}

/** A loaded, ready-to-generate model instance. One active session at a time. */
export interface LoadedModel {
  generate(input: SynthesisInput): Promise<AudioResult>;
  release(): Promise<void>;
}

/**
 * The single seam every TTS engine plugs into.
 * The model router selects among registered providers using capabilities,
 * device report, entitlements, and requested features — never hard-coded ids
 * outside the registry.
 */
export interface TTSModelProvider {
  /** Stable id within the provider registry, e.g. "kokoro-local" (M2). */
  id: string;
  kind: ProviderKind;
  capabilities: ProviderCapabilities;
  requirements?: DeviceRequirements;
  /** Best-effort speed estimate; null when the provider cannot estimate. */
  estimate(ctx: EstimateContext): SpeedEstimate | null;
  load(opts: LoadOptions): Promise<LoadedModel>;
}
