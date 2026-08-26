/**
 * Centralized Kokoro model configuration (single source of truth for model
 * id, quantization, and device policy). Nothing else in the workspace may
 * hard-code these values.
 *
 * Device policy (M2): attempt WebGPU first when present, fall back to WASM.
 * "Present" means a real adapter probe (`navigator.gpu.requestAdapter()`)
 * succeeded — not merely that `navigator.gpu` exists. Each device attempt
 * runs on its own freshly spawned worker so a failed GPU attempt cannot
 * poison the WASM retry; see KokoroLocalProvider.loadOnFirstWorkingDevice.
 * The WebGPU dtype question (kokoro-js recommends fp32 on GPU) is resolved
 * empirically in M3 via runtime benchmarking — see DECISIONS.md D-004/D-015
 * and ARCHITECTURE.md R2. WebGPU is never a requirement.
 */

import { TARGET_SAMPLE_RATE_HZ } from "@tts/audio";

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** q8 ≈ 86 MB download — the default per DECISIONS.md D-004. */
export const KOKORO_DTYPE = "q8" as const;

export const KOKORO_SAMPLE_RATE_HZ = TARGET_SAMPLE_RATE_HZ;

export type KokoroDevice = "webgpu" | "wasm";
export type KokoroDtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16";

export interface KokoroLoadConfig {
  modelId: string;
  dtype: KokoroDtype;
  /** Devices to try in order; first successful load wins. */
  devicePreference: readonly KokoroDevice[];
}

export const KOKORO_DEFAULT_LOAD_CONFIG: KokoroLoadConfig = {
  modelId: KOKORO_MODEL_ID,
  dtype: KOKORO_DTYPE,
  devicePreference: ["webgpu", "wasm"],
};
