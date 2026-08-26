/**
 * Inference environment probing shared by main thread and worker contexts.
 *
 * WebGPU detection here is a cheap presence check (`navigator.gpu`); real
 * adapter validation and benchmarking arrive in M3 (ROADMAP.md, R2). The
 * Kokoro provider treats WebGPU as an optimization only — it falls back to
 * WASM when the GPU path fails to load or generate.
 */

export interface InferenceEnvironment {
  webAssembly: boolean;
  webgpu: boolean;
}

interface MinimalNavigator {
  gpu?: unknown;
}

function currentNavigator(): MinimalNavigator | undefined {
  const nav = (globalThis as { navigator?: MinimalNavigator }).navigator;
  return nav;
}

/** Detect capabilities of the current JS realm (window, worker, or Node test). */
export function detectInferenceEnvironment(nav: MinimalNavigator | undefined = currentNavigator()): InferenceEnvironment {
  const webAssembly =
    typeof globalThis.WebAssembly === "object" &&
    typeof globalThis.WebAssembly.instantiate === "function";
  const webgpu = Boolean(nav && "gpu" in nav && nav.gpu);
  return { webAssembly, webgpu };
}

/**
 * Verify WebGPU is actually usable by requesting an adapter — `navigator.gpu`
 * can exist while `requestAdapter()` fails (headless browsers, disabled
 * drivers, blocklists). Providers must treat WebGPU as usable only when this
 * resolves true; otherwise they skip straight to WASM instead of paying a
 * doomed load attempt first.
 */
export async function probeWebGPUAdapter(
  nav: MinimalNavigator | undefined = currentNavigator(),
): Promise<boolean> {
  const gpu = nav?.gpu as { requestAdapter?: () => Promise<unknown> } | undefined;
  if (!gpu || typeof gpu.requestAdapter !== "function") return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}
