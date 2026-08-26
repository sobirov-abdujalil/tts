import { describe, expect, it } from "vitest";
import { runTtsBenchmark } from "./ttsBenchmark.js";
import type { LoadedModel, TTSModelProvider, TtsErrorCode } from "../index.js";

/** Deterministic clock: tests advance time explicitly. */
function makeClock() {
  let t = 0;
  return {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms;
    },
  };
}

interface FakeModelOptions {
  activeDevice?: "webgpu" | "wasm" | null;
  samples?: number;
  sampleRateHz?: number;
  generateError?: Error;
}

function fakeModel(clock: ReturnType<typeof makeClock>, options: FakeModelOptions = {}) {
  const released = { count: 0 };
  const model: LoadedModel = {
    get activeDevice() {
      return options.activeDevice ?? "wasm";
    },
    async generate() {
      clock.advance(500);
      if (options.generateError) throw options.generateError;
      const pcm = new Float32Array(options.samples ?? 24_000 * 2); // 2 s of audio
      return { sampleRateHz: options.sampleRateHz ?? 24_000, pcm };
    },
    async release() {
      released.count += 1;
    },
  };
  return { model, released };
}

function fakeProvider(
  clock: ReturnType<typeof makeClock>,
  model: LoadedModel,
  options: { loadError?: Error; initMs?: number } = {},
): { provider: TTSModelProvider; loadCalls: { count: number } } {
  const loadCalls = { count: 0 };
  const provider: TTSModelProvider = {
    id: "fake",
    kind: "local",
    capabilities: { voices: [], speedRange: { min: 0.5, max: 2 }, supportsEmotion: false, maxCharsPerRequest: 1000 },
    estimate: () => null,
    async load() {
      loadCalls.count += 1;
      clock.advance(options.initMs ?? 1_000);
      if (options.loadError) throw options.loadError;
      return model;
    },
  };
  return { provider, loadCalls };
}

describe("runTtsBenchmark", () => {
  it("measures init, generation, RTF and speed multiplier on a real generation", async () => {
    const clock = makeClock();
    const { model, released } = fakeModel(clock);
    const { provider, loadCalls } = fakeProvider(clock, model);

    const outcome = await runTtsBenchmark({
      provider,
      config: { modelId: "m", dtype: "q8" },
      now: clock.now,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.initMs).toBe(1_000);
    expect(outcome.generationMs).toBe(500);
    expect(outcome.audioDurationSec).toBeCloseTo(2, 5);
    // rtf = generation_time / audio_duration = 0.5s / 2s
    expect(outcome.rtf).toBeCloseTo(0.25, 5);
    // speedMultiplier = audio_duration / generation_time = "4× real time"
    expect(outcome.speedMultiplier).toBeCloseTo(4, 5);
    expect(outcome.runtimeUsed).toBe("wasm");
    expect(outcome.reusedLoadedModel).toBe(false);
    expect(loadCalls.count).toBe(1);
    // The benchmark loaded its own model → it must release it exactly once.
    expect(released.count).toBe(1);
  });

  it("reuses an already-loaded model without releasing it", async () => {
    const clock = makeClock();
    const { model, released } = fakeModel(clock, { activeDevice: "webgpu" });
    const { provider, loadCalls } = fakeProvider(clock, model);

    const outcome = await runTtsBenchmark({
      provider,
      model,
      config: { modelId: "m", dtype: "q8" },
      now: clock.now,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.initMs).toBe(0);
    expect(outcome.reusedLoadedModel).toBe(true);
    expect(outcome.runtimeUsed).toBe("webgpu");
    expect(loadCalls.count).toBe(0);
    expect(released.count).toBe(0); // owner keeps control
  });

  it("fails honestly when the generated audio is empty", async () => {
    const clock = makeClock();
    const { model, released } = fakeModel(clock, { samples: 0 });
    const outcome = await runTtsBenchmark({
      provider: fakeProvider(clock, model).provider,
      config: { modelId: "m", dtype: "q8" },
      now: clock.now,
    });

    expect(outcome).toMatchObject({
      ok: false,
      stage: "generation",
      code: "generation-failed",
    });
    expect(released.count).toBe(1); // self-loaded resources still cleaned up
  });

  it("maps load failures to a typed init failure", async () => {
    const clock = makeClock();
    const { model } = fakeModel(clock);
    const outcome = await runTtsBenchmark({
      provider: fakeProvider(clock, model, { loadError: new Error("network down") }).provider,
      config: { modelId: "m", dtype: "q8" },
      now: clock.now,
    });

    expect(outcome).toMatchObject({ ok: false, stage: "init", code: "model-load-failed" });
  });

  it("propagates typed error codes from generation failures", async () => {
    const clock = makeClock();
    const failure = Object.assign(new Error("phonemizer"), { code: "generation-failed" as TtsErrorCode, name: "TtsError" });
    const { model, released } = fakeModel(clock, { generateError: failure });
    const outcome = await runTtsBenchmark({
      provider: fakeProvider(clock, model).provider,
      model, // reused → stage must be "generation"
      config: { modelId: "m", dtype: "q8" },
      now: clock.now,
    });

    expect(outcome).toMatchObject({ ok: false, stage: "generation", code: "generation-failed" });
    expect(released.count).toBe(0);
  });

  it("uses the fixed benchmark sentence by default", async () => {
    const clock = makeClock();
    let receivedText = "";
    const model: LoadedModel = {
      activeDevice: "wasm",
      async generate(input) {
        receivedText = input.text;
        return { sampleRateHz: 24_000, pcm: new Float32Array(24_000) };
      },
      async release() {},
    };
    await runTtsBenchmark({
      provider: fakeProvider(clock, model).provider,
      model,
      config: { modelId: "m", dtype: "q8" },
      now: clock.now,
    });
    expect(receivedText.length).toBeGreaterThan(20);
    expect(receivedText).toMatch(/^[A-Z][a-z].*\.$/);
  });
});
