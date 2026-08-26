import { describe, expect, it } from "vitest";
import {
  BENCHMARK_CACHE_KEY,
  BENCHMARK_MAX_AGE_MS,
  BenchmarkCache,
  localStorageStore,
  readStoredDeviceSignature,
  writeStoredDeviceSignature,
  type CachedBenchmark,
  type KeyValueStore,
} from "./benchmarkCache.js";
import { BENCHMARK_VERSION } from "./ttsBenchmark.js";

class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function entry(overrides: Partial<CachedBenchmark> = {}): CachedBenchmark {
  return {
    benchmarkVersion: BENCHMARK_VERSION,
    modelId: "model-a",
    dtype: "q8",
    runtime: "wasm",
    deviceSignature: "sig-1",
    rtf: 0.5,
    speedMultiplier: 2,
    initMs: 4_000,
    generationMs: 1_000,
    audioDurationSec: 2,
    measuredAt: 1_000_000,
    ...overrides,
  };
}

function cache(store: KeyValueStore | null = new MemoryStore(), now = () => 1_000_000): BenchmarkCache {
  return new BenchmarkCache(store, { now });
}

describe("BenchmarkCache", () => {
  it("round-trips a measurement", () => {
    const store = new MemoryStore();
    const c = cache(store);
    const original = entry();
    c.put(original);
    expect(
      c.get({ modelId: "model-a", dtype: "q8", runtime: "wasm", deviceSignature: "sig-1" }),
    ).toEqual(original);
  });

  it("keeps per-runtime entries separately", () => {
    const c = cache();
    c.put(entry({ runtime: "wasm", rtf: 0.9 }));
    c.put(entry({ runtime: "webgpu", rtf: 0.3 }));
    expect(c.get({ modelId: "model-a", dtype: "q8", runtime: "wasm", deviceSignature: "sig-1" })?.rtf).toBe(0.9);
    expect(c.get({ modelId: "model-a", dtype: "q8", runtime: "webgpu", deviceSignature: "sig-1" })?.rtf).toBe(0.3);
  });

  it("invalidates when the benchmark version changes", () => {
    const c = cache();
    c.put(entry({ benchmarkVersion: BENCHMARK_VERSION - 1 }));
    expect(c.get({ modelId: "model-a", dtype: "q8", runtime: "wasm", deviceSignature: "sig-1" })).toBeNull();
  });

  it("invalidates when model, dtype, runtime, or device signature change", () => {
    const c = cache();
    c.put(entry());
    const lookup = { runtime: "wasm" as const };
    expect(c.get({ ...lookup, modelId: "other-model", dtype: "q8", deviceSignature: "sig-1" })).toBeNull();
    expect(c.get({ ...lookup, modelId: "model-a", dtype: "fp32", deviceSignature: "sig-1" })).toBeNull();
    expect(c.get({ ...lookup, modelId: "model-a", dtype: "q8", runtime: "webgpu", deviceSignature: "sig-1" })).toBeNull();
    expect(c.get({ ...lookup, modelId: "model-a", dtype: "q8", runtime: "wasm", deviceSignature: "sig-2" })).toBeNull();
  });

  it("expires after the configured max age (TTL policy)", () => {
    let t = 1_000_000;
    const c = new BenchmarkCache(new MemoryStore(), { now: () => t, maxAgeMs: 5_000 });
    c.put(entry());
    t += 4_999;
    expect(c.get({ modelId: "model-a", dtype: "q8", runtime: "wasm", deviceSignature: "sig-1" })).not.toBeNull();
    t += 2;
    expect(c.get({ modelId: "model-a", dtype: "q8", runtime: "wasm", deviceSignature: "sig-1" })).toBeNull();
  });

  it("uses the documented default TTL of 30 days", () => {
    expect(BENCHMARK_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("discards corrupted containers and recovers on the next write", () => {
    const store = new MemoryStore();
    store.setItem(BENCHMARK_CACHE_KEY, "{not json");
    const c = cache(store);
    expect(c.get({ modelId: "model-a", dtype: "q8", runtime: "wasm", deviceSignature: "sig-1" })).toBeNull();

    c.put(entry()); // heals the container
    expect(c.get({ modelId: "model-a", dtype: "q8", runtime: "wasm", deviceSignature: "sig-1" })).not.toBeNull();
  });

  it("discards structurally invalid entries (tampered fields)", () => {
    const store = new MemoryStore();
    const c = cache(store);
    c.put(entry({ rtf: Number.NaN } as unknown as CachedBenchmark));
    c.put(entry({ audioDurationSec: -5 } as unknown as CachedBenchmark));
    expect(c.getForModel({ modelId: "model-a", dtype: "q8", deviceSignature: "sig-1" })).toBeNull();
  });

  it("getForModel prefers the most recent measurement across runtimes", () => {
    const c = cache();
    c.put(entry({ runtime: "wasm", measuredAt: 100 }));
    c.put(entry({ runtime: "webgpu", measuredAt: 200 }));
    const best = c.getForModel({ modelId: "model-a", dtype: "q8", deviceSignature: "sig-1" });
    expect(best?.runtime).toBe("webgpu");
  });

  it("clear removes everything", () => {
    const c = cache();
    c.put(entry());
    c.clear();
    expect(c.get({ modelId: "model-a", dtype: "q8", runtime: "wasm", deviceSignature: "sig-1" })).toBeNull();
  });

  it("is inert without a backing store (workers/tests)", () => {
    const c = cache(null);
    expect(c.available).toBe(false);
    expect(() => c.put(entry())).not.toThrow();
    expect(c.get({ modelId: "a", dtype: "q8", runtime: "wasm", deviceSignature: "s" })).toBeNull();
  });

  it("localStorageStore is null in Node and signature helpers are safe", () => {
    expect(localStorageStore()).toBeNull();
    expect(readStoredDeviceSignature(null)).toBeNull();
    expect(() => writeStoredDeviceSignature(null, "sig")).not.toThrow();
  });
});
