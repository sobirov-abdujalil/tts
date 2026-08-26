import { describe, expect, it } from "vitest";
import { WORKER_PROTOCOL_VERSION, isMainToWorkerMessage } from "./protocol.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./protocol.js";

describe("kokoro worker protocol", () => {
  it("has a stable protocol version", () => {
    expect(WORKER_PROTOCOL_VERSION).toBe(1);
  });

  it.each([
    { kind: "load", id: 1, payload: { modelId: "m", dtype: "q8", devices: ["wasm"] } },
    { kind: "generate", id: 2, payload: { text: "hi", voiceId: "af_heart", speed: 1 } },
    { kind: "release", id: 3 },
  ] satisfies MainToWorkerMessage[])("accepts valid main→worker message %o", (message) => {
    expect(isMainToWorkerMessage(message)).toBe(true);
  });

  it.each([
    null,
    undefined,
    42,
    {},
    { kind: "bogus", id: 1 },
    { kind: "load" }, // missing id
    { id: 1 }, // missing kind
    { kind: "ready", id: 1 }, // response direction, not request
  ])("rejects non-request value %o", (value) => {
    expect(isMainToWorkerMessage(value)).toBe(false);
  });

  it("round-trips typed messages structurally", () => {
    const responses: WorkerToMainMessage[] = [
      { kind: "load-progress", id: 1, fraction: 0.5 },
      { kind: "ready", id: 1, device: "wasm" },
      { kind: "result", id: 2, sampleRateHz: 24000, pcm: new Float32Array([0.1]) },
      { kind: "released", id: 3 },
      { kind: "error", id: 4, code: "generation-failed", message: "boom" },
    ];
    for (const message of responses) {
      expect(() => structuredClone(message)).not.toThrow();
    }
  });
});
