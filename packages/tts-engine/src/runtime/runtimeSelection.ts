/**
 * Runtime selection — decides which local execution runtimes (WebGPU vs WASM)
 * are worth attempting, in which order, based on the measured DeviceProfile.
 *
 * Policy (DECISIONS.md D-017):
 *  1. WebGPU is a candidate ONLY when the browser exposes it AND a real
 *     adapter probe succeeded. `navigator.gpu` alone is not proof.
 *  2. WASM is always the floor when WebAssembly is supported at all.
 *  3. If neither is possible, local generation is reported unavailable.
 *  4. We never assume WebGPU is faster just because it exists — that is what
 *     the benchmark measures (ttsBenchmark.ts). Selection only decides what
 *     to TRY; measurement decides what to KEEP using.
 */

import type { DeviceProfile } from "../device/deviceProfile.js";
import type { KokoroDevice } from "../providers/kokoro/config.js";

export type WebGPURuntimeState =
  | "unavailable" // browser does not expose WebGPU
  | "adapter-missing" // exposed but no working adapter (headless/soft-blocked)
  | "available" // adapter probe passed — worth attempting
  | "failed"; // attempted previously and failed at load time this session

export interface RuntimeSelectionPlan {
  /** Runtimes to attempt in order; empty when local generation is impossible. */
  candidates: readonly KokoroDevice[];
  primary: KokoroDevice | null;
  localGenerationAvailable: boolean;
  webgpuState: WebGPURuntimeState;
  /** Developer-facing reasoning; never shown to end users as-is. */
  rationale: string[];
  /**
   * Plain-language explanation of the plan for ordinary users. Null when
   * local generation is unavailable.
   */
  userExplanation: string | null;
}

export interface RuntimeSelectionOptions {
  /**
   * Marks WebGPU as failed for this session (a previous load attempt threw).
   * A failed runtime is dropped from candidates until reload/re-measure.
   */
  webgpuFailed?: boolean | undefined;
}

function gpuState(profile: DeviceProfile, webgpuFailed: boolean): WebGPURuntimeState {
  if (webgpuFailed) return "failed";
  if (!profile.webgpu.supported) return "unavailable";
  return profile.webgpu.adapterAvailable ? "available" : "adapter-missing";
}

/** Plain-language label for a runtime actually in use after load/benchmark. */
export function describeActiveRuntime(device: KokoroDevice): string {
  return device === "webgpu"
    ? "Using your GPU for local generation"
    : "Using CPU mode for local generation";
}

export function selectLocalRuntimePlan(
  profile: DeviceProfile,
  options: RuntimeSelectionOptions = {},
): RuntimeSelectionPlan {
  const rationale: string[] = [];

  if (!profile.webAssembly.supported) {
    rationale.push("WebAssembly is not available; local inference cannot run.");
    return {
      candidates: [],
      primary: null,
      localGenerationAvailable: false,
      webgpuState: gpuState(profile, options.webgpuFailed ?? false),
      rationale,
      userExplanation: null,
    };
  }

  const state = gpuState(profile, options.webgpuFailed ?? false);
  switch (state) {
    case "available":
      rationale.push(
        "WebGPU adapter probe succeeded; WebGPU will be attempted before WASM.",
      );
      break;
    case "adapter-missing":
      rationale.push("navigator.gpu exists but no usable adapter was returned; skipping WebGPU.");
      break;
    case "failed":
      rationale.push("A previous WebGPU initialization failed this session; falling back to WASM.");
      break;
    case "unavailable":
      rationale.push("This browser does not expose WebGPU.");
      break;
  }

  const candidates: KokoroDevice[] =
    state === "available" ? ["webgpu", "wasm"] : ["wasm"];

  const userExplanation =
    state === "available"
      ? "Your device has GPU acceleration available — we'll try it first and fall back to CPU if needed."
      : "Your device will use CPU mode for local generation.";

  return {
    candidates,
    primary: candidates[0] ?? null,
    localGenerationAvailable: true,
    webgpuState: state,
    rationale,
    userExplanation,
  };
}
