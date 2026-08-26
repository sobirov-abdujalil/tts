import { describe, expect, it } from "vitest";
import {
  deviceAnalysisReducer,
  initialDeviceAnalysisState,
} from "./deviceAnalysisState.js";
import { describeDeviceSignature } from "@tts/tts-engine";
import type { CachedBenchmark, DeviceProfile, Recommendation } from "@tts/tts-engine";

function profile(): DeviceProfile {
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
  };
}

function benchmark(): CachedBenchmark {
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
  };
}

const recommendation = {
  descriptor: { id: "kokoro-82m-q8", displayName: "Kokoro" },
  runtime: "wasm",
  confidence: "unknown",
  estimatedRealtimeFactor: null,
  reasons: [],
  supported: true,
  unsupportedReason: null,
} as unknown as Recommendation;

describe("deviceAnalysisReducer", () => {
  it("starts in checking phase", () => {
    expect(initialDeviceAnalysisState.phase).toBe("checking");
    expect(initialDeviceAnalysisState.measuring).toBe(false);
  });

  it("transitions to ready with profile and recommendation", () => {
    const next = deviceAnalysisReducer(initialDeviceAnalysisState, {
      type: "profile-ready",
      profile: profile(),
      benchmark: null,
      recommendation,
    });
    expect(next.phase).toBe("ready");
    expect(next.profile).not.toBeNull();
    expect(next.recommendation).toEqual(recommendation);
    expect(next.benchmark).toBeNull();
  });

  it("transitions to unsupported when local generation is impossible", () => {
    const next = deviceAnalysisReducer(initialDeviceAnalysisState, { type: "profile-unavailable" });
    expect(next.phase).toBe("unsupported");
  });

  it("tracks the measurement lifecycle including failure recovery", () => {
    const ready = deviceAnalysisReducer(initialDeviceAnalysisState, {
      type: "profile-ready",
      profile: profile(),
      benchmark: null,
      recommendation,
    });

    const started = deviceAnalysisReducer(ready, { type: "measure-started" });
    expect(started.measuring).toBe(true);
    expect(started.measureError).toBeNull();

    const failed = deviceAnalysisReducer(started, {
      type: "measure-failed",
      message: "measurement exploded",
    });
    expect(failed.measuring).toBe(false);
    expect(failed.measureError).toBe("measurement exploded");
    expect(failed.phase).toBe("ready"); // analysis stays usable

    const retried = deviceAnalysisReducer(failed, { type: "measure-started" });
    expect(retried.measureError).toBeNull();
    const done = deviceAnalysisReducer(retried, {
      type: "measure-completed",
      benchmark: benchmark(),
      recommendation,
    });
    expect(done.measuring).toBe(false);
    expect(done.benchmark?.rtf).toBeCloseTo(0.55, 5);
  });
});
