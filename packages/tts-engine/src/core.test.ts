import { describe, expect, it } from "vitest";
import { classifyRuntimeError, isTtsError, TtsError } from "./errors.js";
import { detectInferenceEnvironment } from "./env.js";

describe("TtsError taxonomy", () => {
  it("preserves code and message", () => {
    const error = new TtsError("model-load-failed", "download failed");
    expect(error.code).toBe("model-load-failed");
    expect(error.message).toBe("download failed");
    expect(isTtsError(error)).toBe(true);
  });

  it("classifies out-of-memory style failures as runtime-failure", () => {
    const classified = classifyRuntimeError(new Error("Aborted(): Out of memory"));
    expect(classified.code).toBe("runtime-failure");
  });

  it("wraps unknown errors as runtime-failure without losing the cause", () => {
    const original = new Error("something exploded");
    const classified = classifyRuntimeError(original);
    expect(classified.code).toBe("runtime-failure");
    expect((classified as { cause?: unknown }).cause).toBe(original);
  });

  it("passes existing TtsErrors through untouched", () => {
    const original = new TtsError("cancelled", "stop");
    expect(classifyRuntimeError(original)).toBe(original);
  });
});

describe("detectInferenceEnvironment", () => {
  it("reports wasm+webgpu when both are present", () => {
    const env = detectInferenceEnvironment({ gpu: {} } as never);
    expect(env).toEqual({ webAssembly: true, webgpu: true });
  });

  it("reports no webgpu when absent", () => {
    const env = detectInferenceEnvironment(undefined);
    expect(env.webAssembly).toBe(true);
    expect(env.webgpu).toBe(false);
  });
});
