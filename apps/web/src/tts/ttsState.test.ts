import { describe, expect, it } from "vitest";
import { initialTtsUiState, ttsUiReducer } from "./ttsState.js";

function run(state: typeof initialTtsUiState, ...events: Parameters<typeof ttsUiReducer>[1][]) {
  return events.reduce(ttsUiReducer, state);
}

describe("ttsUiReducer", () => {
  it("starts in checking phase", () => {
    expect(initialTtsUiState.phase).toBe("checking");
    expect(initialTtsUiState.audioUrl).toBeNull();
  });

  it("moves to idle when the device supports local inference", () => {
    const next = ttsUiReducer(initialTtsUiState, { type: "env-checked", supported: true });
    expect(next.phase).toBe("idle");
  });

  it("moves to unsupported when the device cannot run inference", () => {
    const next = ttsUiReducer(initialTtsUiState, { type: "env-checked", supported: false });
    expect(next.phase).toBe("unsupported");
  });

  it("ignores generate requests in unsupported state", () => {
    const unsupported = run(initialTtsUiState, { type: "env-checked", supported: false });
    const next = ttsUiReducer(unsupported, { type: "generate-requested", needsModel: true });
    expect(next).toBe(unsupported);
  });

  it("tracks the first-generation lifecycle with model loading", () => {
    const state = run(
      initialTtsUiState,
      { type: "env-checked", supported: true },
      { type: "generate-requested", needsModel: true },
      { type: "load-progress", fraction: 0.4 },
      { type: "load-progress", fraction: 0.9 },
    );
    expect(state.phase).toBe("loading-model");
    expect(state.progress).toBeCloseTo(0.9);

    const generating = ttsUiReducer(state, { type: "model-ready", device: "wasm" });
    expect(generating.phase).toBe("generating");
    expect(generating.activeDevice).toBe("wasm");
    expect(generating.progress).toBeNull();

    const done = ttsUiReducer(generating, {
      type: "generation-succeeded",
      url: "blob:x",
      bytes: 1024,
    });
    expect(done.phase).toBe("ready");
    expect(done.audioUrl).toBe("blob:x");
    expect(done.audioBytes).toBe(1024);
  });

  it("skips loading-model when the model is already loaded", () => {
    const ready = run(
      initialTtsUiState,
      { type: "env-checked", supported: true },
      {
        type: "generation-succeeded",
        url: "blob:first",
        bytes: 10,
      },
      { type: "model-ready", device: "webgpu" },
    );
    const next = ttsUiReducer({ ...ready, phase: "ready" }, {
      type: "generate-requested",
      needsModel: false,
    });
    expect(next.phase).toBe("generating");
  });

  it("clamps load progress into [0,1]", () => {
    const state = run(
      initialTtsUiState,
      { type: "env-checked", supported: true },
      { type: "generate-requested", needsModel: true },
      { type: "load-progress", fraction: 5 },
    );
    expect(state.progress).toBe(1);
  });

  it("records failures and settles to a recoverable phase without losing audio", () => {
    const withAudio = run(
      initialTtsUiState,
      { type: "env-checked", supported: true },
      { type: "generate-requested", needsModel: true },
      { type: "model-ready", device: "wasm" },
      { type: "generation-succeeded", url: "blob:keep", bytes: 5 },
    );

    const failed = run(
      { ...withAudio },
      { type: "generate-requested", needsModel: false },
      { type: "operation-failed", code: "runtime-failure", message: "out of memory" },
    );
    expect(failed.phase).toBe("ready"); // model still loaded → can retry
    expect(failed.error).toMatchObject({ code: "runtime-failure" });
    expect(failed.audioUrl).toBe("blob:keep"); // previous result preserved
  });

  it("settles back to idle when a failure occurs before any successful load", () => {
    const failed = run(
      initialTtsUiState,
      { type: "env-checked", supported: true },
      { type: "generate-requested", needsModel: true },
      { type: "operation-failed", code: "model-load-failed", message: "network down" },
    );
    expect(failed.phase).toBe("idle");
    expect(failed.error).toMatchObject({ code: "model-load-failed" });
  });

  it("restores a clean phase on cancellation without an error banner", () => {
    const cancelled = run(
      initialTtsUiState,
      { type: "env-checked", supported: true },
      { type: "generate-requested", needsModel: true },
      { type: "model-ready", device: "webgpu" },
      { type: "operation-cancelled" },
    );
    expect(cancelled.phase).toBe("ready");
    expect(cancelled.error).toBeNull();
  });

  it("dismisses errors", () => {
    const failed = run(
      initialTtsUiState,
      { type: "env-checked", supported: true },
      { type: "operation-failed", code: "generation-failed", message: "boom" },
    );
    const dismissed = ttsUiReducer(failed, { type: "error-dismissed" });
    expect(dismissed.error).toBeNull();
  });
});

describe("model-released (idle reclamation)", () => {
  it("resets to idle from ready while keeping finished audio", () => {
    const state = run(
      initialTtsUiState,
      { type: "env-checked", supported: true },
      { type: "generate-requested", needsModel: true },
      { type: "model-ready", device: "wasm" },
      { type: "generation-succeeded", url: "blob:x", bytes: 10 },
    );
    const next = ttsUiReducer(state, { type: "model-released" });
    expect(next.phase).toBe("idle");
    expect(next.activeDevice).toBeNull();
    expect(next.audioUrl).toBe("blob:x");
  });

  it("is ignored mid-generation or mid-load", () => {
    for (const event of [
      { type: "generate-requested", needsModel: false },
      { type: "generate-requested", needsModel: true },
    ] as const) {
      const busy = run(initialTtsUiState, { type: "env-checked", supported: true }, event);
      const next = ttsUiReducer(busy, { type: "model-released" });
      expect(next.phase).not.toBe("idle");
      expect(next.phase).toBe(busy.phase);
    }
  });
});
