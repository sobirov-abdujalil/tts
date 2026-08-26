/**
 * Device capability detection (ROADMAP.md M3, ARCHITECTURE.md §4.3).
 *
 * Produces a structured profile of what this browser/device can do for local
 * inference, with an explicit honesty level per signal:
 *
 *  - "known"     — reported definitively by a standard API
 *                  (e.g. navigator.hardwareConcurrency)
 *  - "estimated" — an approximation exposed by the browser
 *                  (e.g. navigator.deviceMemory is a coarse bucket capped at 8)
 *  - "unknown"   — the platform does not expose it; we refuse to guess
 *
 * Privacy (SECURITY.md §6, DECISIONS D-016): everything here stays on the
 * device. We deliberately avoid fingerprinting-grade signals — no canvas/WebGL
 * probes, no font enumeration, no detailed UA parsing beyond a coarse browser
 * family that is genuinely useful for WebGPU expectations.
 */

export type Confidence = "known" | "estimated" | "unknown";

/** A single detected signal with how much we trust it. */
export interface Capability<T> {
  confidence: Confidence;
  /** null exactly when confidence is "unknown". */
  value: T | null;
}

export interface WebGPUAdapterInfoHint {
  vendor?: string;
  architecture?: string;
}

export interface DeviceProfile {
  webgpu: {
    /** `navigator.gpu` exists — presence only, NOT proof it works. */
    supported: boolean;
    /** `requestAdapter()` resolved truthy — the honest usability signal. */
    adapterAvailable: boolean;
    adapterInfo: Capability<WebGPUAdapterInfoHint>;
  };
  webAssembly: {
    supported: boolean;
  };
  /** Logical cores as reported by the OS to the browser ("known" but not physical). */
  cpuThreads: Capability<number>;
  /**
   * Approximate RAM bucket from `navigator.deviceMemory` (Chromium only,
   * rounded down to powers of two and capped at 8 GB by the spec).
   */
  deviceMemoryGB: Capability<number>;
  crossOriginIsolated: Capability<boolean>;
  sharedArrayBuffer: Capability<boolean>;
  /** Storage quota estimate from `navigator.storage.estimate()`. */
  storage: Capability<{ quotaBytes: number; usageBytes: number }>;
  /** Coarse browser family — only used to set WebGPU expectations in copy. */
  browserKind: Capability<"chromium" | "firefox" | "safari" | "unknown">;
  detectedAt: number;
}

function known<T>(value: T): Capability<T> {
  return { confidence: "known", value };
}

function estimated<T>(value: T): Capability<T> {
  return { confidence: "estimated", value };
}

function unknown<T>(): Capability<T> {
  return { confidence: "unknown", value: null };
}

/** Structural navigator surface consumed here; injectable for tests. */
export interface NavigatorLike {
  gpu?: { requestAdapter?: (options?: unknown) => Promise<unknown> } | undefined;
  hardwareConcurrency?: number | undefined;
  deviceMemory?: number | undefined;
  userAgentData?: { brands?: Array<{ brand: string; version: string }> } | undefined;
  userAgent?: string | undefined;
  storage?: { estimate?: () => Promise<StorageEstimate> } | undefined;
}

export interface StorageEstimate {
  quota?: number | undefined;
  usage?: number | undefined;
}

export interface DeviceProfileDeps {
  navigator?: NavigatorLike | undefined;
  /** Defaults to the real global; injectable because jsdom/Node may lack it. */
  storageEstimate?: (() => Promise<StorageEstimate>) | undefined;
  crossOriginIsolated?: boolean | undefined;
  sharedArrayBuffer?: boolean | undefined;
  now?: (() => number) | undefined;
}

function currentNavigator(): NavigatorLike | undefined {
  const nav = (globalThis as { navigator?: NavigatorLike }).navigator;
  return nav;
}

async function requestAdapterWithInfo(
  nav: NavigatorLike | undefined,
): Promise<{ available: boolean; info: WebGPUAdapterInfoHint | null } | null> {
  // null when WebGPU is entirely absent (caller records supported=false).
  const gpu = nav?.gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") return null;
  try {
    const adapter = (await gpu.requestAdapter()) as
      | { info?: { vendor?: unknown; architecture?: unknown } | undefined }
      | null
      | undefined;
    if (!adapter) return { available: false, info: null };
    let info: WebGPUAdapterInfoHint | null = null;
    const raw = adapter.info;
    if (raw && typeof raw === "object") {
      const vendor = typeof raw.vendor === "string" && raw.vendor.length > 0 ? raw.vendor : undefined;
      const architecture =
        typeof raw.architecture === "string" && raw.architecture.length > 0 ? raw.architecture : undefined;
      if (vendor !== undefined || architecture !== undefined) info = { vendor, architecture };
    }
    return { available: true, info };
  } catch {
    // A throwing probe counts as "adapter missing" — never a crash.
    return { available: false, info: null };
  }
}

function detectBrowserKind(nav: NavigatorLike | undefined): Capability<"chromium" | "firefox" | "safari" | "unknown"> {
  // Prefer UA-CH brands when present (Chromium only, coarse by design).
  const brands = nav?.userAgentData?.brands;
  if (Array.isArray(brands)) {
    const joined = brands.map((b) => b.brand).join(" ");
    if (/Chromium|Google Chrome|Microsoft Edge/i.test(joined)) return known("chromium");
  }
  const ua = nav?.userAgent ?? "";
  if (/Firefox\//i.test(ua)) return known("firefox");
  if (/Safari\//i.test(ua) && !/Chrome|Chromium|Edg\//i.test(ua)) return known("safari");
  return unknown();
}

/**
 * Detect the device profile. Async because the WebGPU adapter probe and the
 * storage estimate are asynchronous; safe to call in any realm. All inputs are
 * injectable so tests can simulate devices without real hardware.
 */
export async function detectDeviceProfile(deps: DeviceProfileDeps = {}): Promise<DeviceProfile> {
  const nav = deps.navigator ?? currentNavigator();
  const now = deps.now ?? Date.now;

  const webgpuProbe = await requestAdapterWithInfo(nav);

  const cpuThreads =
    typeof nav?.hardwareConcurrency === "number" && Number.isFinite(nav.hardwareConcurrency) && nav.hardwareConcurrency > 0
      ? known(Math.floor(nav.hardwareConcurrency))
      : unknown<number>();

  const deviceMemoryGB =
    typeof nav?.deviceMemory === "number" && Number.isFinite(nav.deviceMemory) && nav.deviceMemory > 0
      ? estimated(nav.deviceMemory)
      : unknown<number>();

  const isolated = deps.crossOriginIsolated ?? (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated;
  const crossOriginIsolated = typeof isolated === "boolean" ? known(isolated) : unknown<boolean>();

  const sab = deps.sharedArrayBuffer ?? typeof (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer === "function";
  const sharedArrayBuffer = known(sab);

  let storage = unknown<{ quotaBytes: number; usageBytes: number }>();
  try {
    const estimator = deps.storageEstimate ?? nav?.storage?.estimate?.bind(nav.storage);
    if (estimator) {
      const estimate = await estimator();
      if (
        estimate &&
        typeof estimate.quota === "number" &&
        Number.isFinite(estimate.quota) &&
        typeof estimate.usage === "number"
      ) {
        storage = estimated({ quotaBytes: estimate.quota, usageBytes: estimate.usage });
      }
    }
  } catch {
    storage = unknown();
  }

  return {
    webgpu: {
      supported: webgpuProbe !== null,
      adapterAvailable: webgpuProbe?.available ?? false,
      adapterInfo:
        webgpuProbe !== null && webgpuProbe.info !== null
          ? known(webgpuProbe.info)
          : unknown<WebGPUAdapterInfoHint>(),
    },
    webAssembly: {
      supported:
        typeof (globalThis as { WebAssembly?: { instantiate?: unknown } }).WebAssembly === "object" &&
        typeof (globalThis as { WebAssembly?: { instantiate?: unknown } }).WebAssembly?.instantiate === "function",
    },
    cpuThreads,
    deviceMemoryGB,
    crossOriginIsolated,
    sharedArrayBuffer,
    storage,
    browserKind: detectBrowserKind(nav),
    detectedAt: now(),
  };
}

/**
 * Stable fingerprint of the inputs that make a benchmark result comparable.
 * Stored alongside cached benchmarks; a mismatch means the execution
 * environment changed and measurements must be re-taken (see benchmarkCache).
 */
export function describeDeviceSignature(profile: DeviceProfile): string {
  return JSON.stringify({
    threads: profile.cpuThreads.value,
    memoryGB: profile.deviceMemoryGB.value,
    isolated: profile.crossOriginIsolated.value,
    browser: profile.browserKind.value,
    sab: profile.sharedArrayBuffer.value,
  });
}

/** Compatibility view for the provider `estimate(ctx)` contract. */
export function toDeviceReport(profile: DeviceProfile): {
  webgpuAvailable: boolean;
  cpuCores: number;
  deviceMemoryGB?: number;
  crossOriginIsolated: boolean;
  storageQuotaBytes?: number;
} {
  return {
    webgpuAvailable: profile.webgpu.adapterAvailable,
    cpuCores: profile.cpuThreads.value ?? 0,
    ...(profile.deviceMemoryGB.value !== null ? { deviceMemoryGB: profile.deviceMemoryGB.value } : {}),
    crossOriginIsolated: profile.crossOriginIsolated.value ?? false,
    ...(profile.storage.value !== null ? { storageQuotaBytes: profile.storage.value.quotaBytes } : {}),
  };
}
