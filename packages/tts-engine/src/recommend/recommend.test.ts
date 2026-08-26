import { describe, expect, it } from "vitest";
import { recommendModels } from "./recommend.js";
import { getModelDescriptor, registerModel, type ModelDescriptor } from "./models.js";
import { describeDeviceSignature } from "../device/deviceProfile.js";
import type { CachedBenchmark } from "../benchmark/benchmarkCache.js";
import type { DeviceProfile } from "../device/deviceProfile.js";

function profile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    webgpu: { supported: false, adapterAvailable: false, adapterInfo: { confidence: "unknown", value: null } },
    webAssembly: { supported: true },
    cpuThreads: { confidence: "known", value: 8 },
    deviceMemoryGB: { confidence: "unknown", value: null },
    crossOriginIsolated: { confidence: "known", value: true },
    sharedArrayBuffer: { confidence: "known", value: true },
    storage: { confidence: "unknown", value: null },
    browserKind: { confidence: "unknown", value: null },
    detectedAt: 0,
    ...overrides,
  };
}

function benchmark(overrides: Partial<CachedBenchmark> = {}): CachedBenchmark {
  return {
    benchmarkVersion: 1,
    modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
    dtype: "q8",
    runtime: "wasm",
    deviceSignature: describeDeviceSignature(profile()),
    rtf: 0.55,
    speedMultiplier: 1.8,
    initMs: 3_000,
    generationMs: 1_100,
    audioDurationSec: 2,
    measuredAt: 500,
    ...overrides,
  };
}

const KOKORO = "kokoro-82m-q8";

/** Register a throwaway descriptor derived from Kokoro's shape. */
function registerFixture(id: string, overrides: Partial<ModelDescriptor>): void {
  const base = getModelDescriptor(KOKORO)!;
  registerModel({ ...base, id, providerId: `provider-${id}`, modelId: `test/${id}`, ...overrides });
}

describe("recommendModels", () => {
  it("recommends Kokoro as supported for a typical desktop device", () => {
    const results = recommendModels({ profile: profile() });
    const first = results[0]!;
    expect(first.descriptor.id).toBe(KOKORO);
    expect(first.supported).toBe(true);
    expect(first.unsupportedReason).toBeNull();
    expect(results.slice(1).every((r) => r.descriptor.id !== KOKORO)).toBe(true);
    expect(first.reasons.join(" ")).toContain("your browser");
  });

  it("reports unknown confidence and no invented RTF without a measurement", () => {
    const first = recommendModels({ profile: profile() })[0]!;
    expect(first.confidence).toBe("unknown");
    expect(first.estimatedRealtimeFactor).toBeNull();
    expect(first.reasons.join(" ")).toContain("has not been measured");
  });

  it("uses a cached measurement when one matches model+dtype+runtime+device", () => {
    const deviceProfile = profile();
    const first = recommendModels({ profile: deviceProfile, benchmarks: [benchmark()] })[0]!;
    expect(first.confidence).toBe("measured");
    expect(first.estimatedRealtimeFactor).toBeCloseTo(0.55, 5);
    expect(first.reasons.join(" ")).toContain("Measured on this device");
  });

  it("ignores measurements taken on a different device signature", () => {
    const otherDevice = benchmark({ deviceSignature: '{"different":true}' });
    const first = recommendModels({ profile: profile(), benchmarks: [otherDevice] })[0]!;
    expect(first.confidence).toBe("unknown");
  });

  it("selects the runtime from the device plan (webgpu candidate vs wasm only)", () => {
    const withGpu = profile({
      webgpu: { supported: true, adapterAvailable: true, adapterInfo: { confidence: "unknown", value: null } },
    });
    expect(recommendModels({ profile: withGpu })[0]!.runtime).toBe("webgpu");
    expect(recommendModels({ profile: profile() })[0]!.runtime).toBe("wasm");
  });

  it("marks models unsupported on devices without WebAssembly", () => {
    const results = recommendModels({ profile: profile({ webAssembly: { supported: false } }) });
    for (const recommendation of results) {
      expect(recommendation.supported).toBe(false);
      expect(recommendation.unsupportedReason).toMatch(/WebAssembly/i);
      expect(recommendation.runtime).toBeNull();
    }
  });

  it("honors minCpuThreads requirements from descriptors", () => {
    registerFixture("test-heavy-model", { minRequirements: { requiresWasm: true, minCpuThreads: 16 } });
    const results = recommendModels({ profile: profile({ cpuThreads: { confidence: "known", value: 2 } }) });

    const heavy = results.find((r) => r.descriptor.id === "test-heavy-model")!;
    expect(heavy.supported).toBe(false);
    expect(heavy.unsupportedReason).toMatch(/16 CPU threads/);

    // Unknown thread count → no enforced rejection (we don't pretend to know).
    const unknownThreads = recommendModels({ profile: profile({ cpuThreads: { confidence: "unknown", value: null } }) });
    expect(unknownThreads.find((r) => r.descriptor.id === "test-heavy-model")!.supported).toBe(true);
  });

  it("ranks a small fast draft model first for speed intent once measured", () => {
    registerFixture("test-fast-draft", {
      qualityCategory: "draft",
      expectedDownloadBytes: 20 * 1024 * 1024,
      supportsEmotion: false,
    });

    const fastBench = benchmark({
      modelId: "test/test-fast-draft",
      rtf: 0.2,
      speedMultiplier: 5,
    });
    const speedFirst = recommendModels({ profile: profile(), benchmarks: [fastBench], requirements: { intent: "speed" } });
    expect(speedFirst[0]!.descriptor.id).toBe("test-fast-draft");

    const qualityFirst = recommendModels({ profile: profile(), benchmarks: [fastBench], requirements: { intent: "quality" } });
    expect(qualityFirst[0]!.descriptor.id).toBe(KOKORO);
  });

  it("notes the absence of emotion support for expressive intent without failing", () => {
    const results = recommendModels({ profile: profile(), requirements: { intent: "expressive" } });
    const kokoro = results.find((r) => r.descriptor.id === KOKORO)!;
    expect(kokoro.supported).toBe(true);
    expect(kokoro.reasons.join(" ")).toContain("emotion tags are not supported");
  });
});
