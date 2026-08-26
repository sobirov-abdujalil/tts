/**
 * Benchmark result cache — local-only persistence of measured device speed
 * (ARCHITECTURE.md §4.3, DECISIONS.md D-017).
 *
 * Storage: any synchronous key/value store; the browser default is
 * localStorage. Nothing here ever touches the network — benchmark data stays
 * on the device by design (privacy invariant).
 *
 * Invalidation policy (all encoded in `get`, all documented):
 *  - BENCHMARK_VERSION changed (methodology change)
 *  - model id / dtype changed (different weights)
 *  - runtime changed (WebGPU vs WASM numbers are not comparable)
 *  - device signature changed (different threads/memory/isolation/browser —
 *    likely a different machine or a materially different configuration)
 *  - older than BENCHMARK_MAX_AGE_MS (30 days): drivers/updates drift and
 *    stale measurements would erode trust in estimates
 *
 * Corrupted entries (hand-edited or partially written) are detected by shape
 * validation and discarded.
 */

import type { KokoroDevice } from "../providers/kokoro/config.js";
import { BENCHMARK_VERSION } from "./ttsBenchmark.js";

/** localStorage lifetime for one measurement. 30 days — see policy above. */
export const BENCHMARK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const BENCHMARK_CACHE_KEY = "tts.benchmark.results.v1";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CachedBenchmark {
  benchmarkVersion: number;
  modelId: string;
  dtype: string;
  runtime: KokoroDevice;
  /** From describeDeviceSignature() at measurement time. */
  deviceSignature: string;
  rtf: number;
  speedMultiplier: number;
  initMs: number;
  generationMs: number;
  audioDurationSec: number;
  /** Epoch ms when the measurement was taken. */
  measuredAt: number;
}

export interface BenchmarkLookup {
  modelId: string;
  dtype: string;
  runtime: KokoroDevice;
}

function cacheEntryId(lookup: BenchmarkLookup): string {
  return `${lookup.modelId}|${lookup.dtype}|${lookup.runtime}`;
}

/** localStorage-backed store; null in environments without it (tests, workers). */
export function localStorageStore(): KeyValueStore | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Accessing localStorage can throw in privacy modes.
    return null;
  }
}

function isValidEntry(value: unknown): value is CachedBenchmark {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.benchmarkVersion === "number" &&
    typeof entry.modelId === "string" &&
    typeof entry.dtype === "string" &&
    (entry.runtime === "webgpu" || entry.runtime === "wasm") &&
    typeof entry.deviceSignature === "string" &&
    typeof entry.rtf === "number" &&
    Number.isFinite(entry.rtf) &&
    entry.rtf > 0 &&
    typeof entry.speedMultiplier === "number" &&
    Number.isFinite(entry.speedMultiplier) &&
    typeof entry.initMs === "number" &&
    typeof entry.generationMs === "number" &&
    typeof entry.audioDurationSec === "number" &&
    Number.isFinite(entry.audioDurationSec) &&
    entry.audioDurationSec > 0 &&
    typeof entry.measuredAt === "number"
  );
}

interface StoredFile {
  entries: Record<string, CachedBenchmark>;
}

export class BenchmarkCache {
  private readonly maxAgeMs: number;
  private readonly now: () => number;

  constructor(
    private readonly store: KeyValueStore | null,
    options: { maxAgeMs?: number; now?: () => number } = {},
  ) {
    this.maxAgeMs = options.maxAgeMs ?? BENCHMARK_MAX_AGE_MS;
    this.now = options.now ?? Date.now;
  }

  get available(): boolean {
    return this.store !== null;
  }

  /**
   * Valid cached measurement for this exact configuration + device, or null.
   * Any policy mismatch returns null without deleting — the next `put`
   * overwrites the slot naturally.
   */
  get(lookup: BenchmarkLookup & { deviceSignature: string }): CachedBenchmark | null {
    if (!this.store) return null;
    let file: StoredFile;
    try {
      const raw = this.store.getItem(BENCHMARK_CACHE_KEY);
      if (!raw) return null;
      file = JSON.parse(raw) as StoredFile;
    } catch {
      return null; // corrupted container — treated as absent
    }

    const entry = file?.entries?.[cacheEntryId(lookup)];
    if (!isValidEntry(entry)) return null;

    if (entry.benchmarkVersion !== BENCHMARK_VERSION) return null;
    if (entry.modelId !== lookup.modelId) return null;
    if (entry.dtype !== lookup.dtype) return null;
    if (entry.runtime !== lookup.runtime) return null;
    if (entry.deviceSignature !== lookup.deviceSignature) return null;
    if (this.now() - entry.measuredAt > this.maxAgeMs) return null;

    return entry;
  }

  /** Most recent valid cached entry across runtimes for this model/dtype/device. */
  getForModel(
    lookup: Omit<BenchmarkLookup, "runtime"> & { deviceSignature: string },
  ): CachedBenchmark | null {
    const runtimes: KokoroDevice[] = ["webgpu", "wasm"];
    let best: CachedBenchmark | null = null;
    for (const runtime of runtimes) {
      const entry = this.get({ ...lookup, runtime });
      if (entry && (best === null || entry.measuredAt > best.measuredAt)) best = entry;
    }
    return best;
  }

  put(entry: CachedBenchmark): void {
    if (!this.store) return;
    let file: StoredFile = { entries: {} };
    try {
      const raw = this.store.getItem(BENCHMARK_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredFile;
        if (parsed && typeof parsed.entries === "object" && parsed.entries !== null) {
          file = { entries: parsed.entries };
        }
      }
    } catch {
      file = { entries: {} }; // corrupted container — start fresh
    }

    file.entries[cacheEntryId(entry)] = entry;
    try {
      this.store.setItem(BENCHMARK_CACHE_KEY, JSON.stringify(file));
    } catch {
      // Quota/private-mode failures are non-fatal; benchmarks stay ephemeral.
      this.store.removeItem(BENCHMARK_CACHE_KEY);
    }
  }

  clear(): void {
    if (!this.store) return;
    try {
      this.store.removeItem(BENCHMARK_CACHE_KEY);
    } catch {
      // ignore
    }
  }
}

/** Process-wide default cache bound to localStorage (or an inert one). */
let defaultCache: BenchmarkCache | null = null;

export function getDefaultBenchmarkCache(): BenchmarkCache {
  defaultCache ??= new BenchmarkCache(localStorageStore());
  return defaultCache;
}

// ---------------------------------------------------------------------------
// Device signature persistence
//
// The provider's synchronous estimate() needs the current device signature
// without running the (async) capability probe. The app persists the latest
// detected signature here after each analysis; lookups compare against it so
// an estimate is only ever served for the exact device it was measured on.
// ---------------------------------------------------------------------------

export const DEVICE_SIGNATURE_KEY = "tts.device.signature.v1";

export function readStoredDeviceSignature(store: KeyValueStore | null): string | null {
  if (!store) return null;
  try {
    return store.getItem(DEVICE_SIGNATURE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredDeviceSignature(store: KeyValueStore | null, signature: string): void {
  if (!store) return;
  try {
    store.setItem(DEVICE_SIGNATURE_KEY, signature);
  } catch {
    // Best-effort only.
  }
}
