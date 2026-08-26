import { describe, expect, it } from "vitest";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./protocol.js";
import { KokoroLocalProvider, type WorkerHandle } from "./kokoroProvider.js";
import type { LoadedModel } from "../../index.js";
import type { KokoroDevice } from "./config.js";

/**
 * Scriptable worker stand-in: records posted messages, optionally auto-answers
 * the load handshake (or fails it), and lets tests deliver worker replies
 * manually.
 */
class FakeWorker implements WorkerHandle {
  readonly sent: MainToWorkerMessage[] = [];
  terminated = false;
  handler: ((event: MessageEvent<WorkerToMainMessage>) => void) | null = null;

  /**
   * Device to auto-answer loads with; null keeps the load pending.
   * "fail" answers every load with a model-load-failed error instead.
   */
  constructor(private readonly autoLoadDevice: KokoroDevice | null | "fail") {}

  set onmessage(handler: ((event: MessageEvent<WorkerToMainMessage>) => void) | null) {
    this.handler = handler;
  }

  postMessage(message: MainToWorkerMessage): void {
    this.sent.push(message);
    if (message.kind !== "load") return;
    if (this.autoLoadDevice === "fail") {
      this.reply({
        kind: "error",
        id: message.id,
        code: "model-load-failed",
        message: `cannot initialize ${message.payload.devices[0]}`,
      });
      return;
    }
    if (this.autoLoadDevice !== null) {
      this.reply({ kind: "load-progress", id: message.id, fraction: 0.25 });
      this.reply({ kind: "load-progress", id: message.id, fraction: 0.9 });
      this.reply({ kind: "ready", id: message.id, device: this.autoLoadDevice });
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(message: WorkerToMainMessage): void {
    this.handler?.({ data: message } as MessageEvent<WorkerToMainMessage>);
  }

  lastId(): number {
    return this.sent[this.sent.length - 1]!.id;
  }
}

interface HarnessOptions {
  /** Adapter-probe result; undefined uses the real default (false in Node). */
  webgpuProbe?: () => Promise<boolean>;
}

function createHarness(
  autoLoadDevice: KokoroDevice | null | "fail" = "wasm",
  options: HarnessOptions = {},
): {
  provider: KokoroLocalProvider;
  workers: FakeWorker[];
  latest: () => FakeWorker;
} {
  const workers: FakeWorker[] = [];
  const factory = (): FakeWorker => {
    const worker = new FakeWorker(autoLoadDevice);
    workers.push(worker);
    return worker;
  };
  return {
    provider: new KokoroLocalProvider({
      workerFactory: factory,
      loadConfig: { modelId: "test-model", dtype: "q8", devicePreference: ["webgpu", "wasm"] },
      ...(options.webgpuProbe ? { webgpuProbe: options.webgpuProbe } : {}),
    }),
    workers,
    latest: () => workers[workers.length - 1]!,
  };
}

async function load(provider: KokoroLocalProvider): Promise<LoadedModel> {
  return provider.load({ onProgress: () => {} });
}

/** Flush the microtask queue so queued requests have actually been posted. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Id of the most recent message of a given kind posted to the worker. */
function lastMessageId(worker: FakeWorker, kind: "generate" | "release" | "load"): number {
  const message = [...worker.sent].reverse().find((m) => m.kind === kind);
  if (!message) throw new Error(`no ${kind} message was sent`);
  return message.id;
}

describe("KokoroLocalProvider", () => {
  it("reports progress during load and adopts the worker-chosen device", async () => {
    const { provider, workers } = createHarness();
    const fractions: number[] = [];
    await provider.load({ onProgress: (fraction) => fractions.push(fraction) });

    expect(fractions).toEqual([0.25, 0.9]);
    expect(provider.activeDevice).toBe("wasm");
    const loadMessages = workers[0]!.sent.filter((m) => m.kind === "load");
    expect(loadMessages).toHaveLength(1);
    expect(loadMessages[0]).toMatchObject({
      payload: { modelId: "test-model", dtype: "q8", devices: ["wasm"] },
    });
  });

  it("skips the WebGPU attempt when the adapter probe fails", async () => {
    // No injected probe → real default runs → false in Node.
    const { provider, workers, latest } = createHarness();
    await provider.load({ onProgress: () => {} });

    expect(workers).toHaveLength(1);
    expect(latest().sent.filter((m) => m.kind === "load")).toHaveLength(1);
    expect(latest().sent.find((m) => m.kind === "load")).toMatchObject({
      payload: { devices: ["wasm"] },
    });
  });

  it("attempts WebGPU first when the adapter probe passes", async () => {
    const { provider, workers } = createHarness("webgpu", {
      webgpuProbe: async () => true,
    });
    await provider.load({ onProgress: () => {} });

    expect(workers).toHaveLength(1);
    expect(provider.activeDevice).toBe("webgpu");
    expect(workers[0]!.sent.find((m) => m.kind === "load")).toMatchObject({
      payload: { devices: ["webgpu"] },
    });
  });

  it("falls back to WASM on a fresh worker after a failed WebGPU load", async () => {
    const workers: FakeWorker[] = [];
    let spawnCount = 0;
    const provider = new KokoroLocalProvider({
      workerFactory: () => {
        // First spawn cannot use WebGPU; the retry gets a healthy WASM worker.
        const worker = new FakeWorker(spawnCount === 0 ? "fail" : "wasm");
        spawnCount += 1;
        workers.push(worker);
        return worker;
      },
      webgpuProbe: async () => true,
    });

    await provider.load({ onProgress: () => {} });

    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true); // poisoned attempt discarded
    expect(provider.activeDevice).toBe("wasm");
    expect(workers[1]!.sent.filter((m) => m.kind === "load")).toHaveLength(1);
    expect(workers[1]!.sent.find((m) => m.kind === "load")).toMatchObject({
      payload: { devices: ["wasm"] },
    });
  });

  it("surfaces a typed load error when every candidate device fails", async () => {
    const { provider } = createHarness("fail", { webgpuProbe: async () => true });
    await expect(provider.load({ onProgress: () => {} })).rejects.toMatchObject({
      code: "model-load-failed",
      message: expect.stringContaining("cannot initialize wasm"),
    });
  });

  it("reuses the loaded session across generations (no reload per generation)", async () => {
    const harness = createHarness();
    const model = await load(harness.provider);

    for (const text of ["first", "second", "third"]) {
      const pending = model.generate({ text, voiceId: "af_heart" });
      await tick();
      harness.latest().reply({
        kind: "result",
        id: lastMessageId(harness.latest(), "generate"),
        sampleRateHz: 24000,
        pcm: Float32Array.from([0.1]),
      });
      await pending;
    }

    expect(harness.workers[0]!.sent.filter((m) => m.kind === "load")).toHaveLength(1);
    expect(harness.workers[0]!.sent.filter((m) => m.kind === "generate")).toHaveLength(3);
  });

  it("resolves generate with the audio result", async () => {
    const harness = createHarness();
    const model = await load(harness.provider);
    const pending = model.generate({ text: "hello there", voiceId: "af_heart" });
    await tick();
    harness.latest().reply({
      kind: "result",
      id: lastMessageId(harness.latest(), "generate"),
      sampleRateHz: 24000,
      pcm: Float32Array.from([0.5, -0.5]),
    });
    const result = await pending;

    expect(result.sampleRateHz).toBe(24000);
    expect(Array.from(result.pcm)).toEqual([0.5, -0.5]);
    expect(harness.latest().sent.at(-1)).toMatchObject({
      payload: { text: "hello there", voiceId: "af_heart", speed: 1 },
    });
  });

  it("surfaces worker failures as typed errors", async () => {
    const harness = createHarness();
    const model = await load(harness.provider);
    const pending = model.generate({ text: "hello", voiceId: "af_heart" });
    await tick();
    harness.latest().reply({
      kind: "error",
      id: lastMessageId(harness.latest(), "generate"),
      code: "generation-failed",
      message: "phonemizer exploded",
    });

    await expect(pending).rejects.toMatchObject({
      code: "generation-failed",
      message: expect.stringContaining("phonemizer"),
    });
  });

  it("rejects invalid input without contacting the worker", async () => {
    const harness = createHarness();
    const model = await load(harness.provider);
    const before = harness.latest().sent.length;

    await expect(model.generate({ text: "   ", voiceId: "af_heart" })).rejects.toMatchObject({
      code: "invalid-input",
    });
    await expect(model.generate({ text: "hi", voiceId: "zz_unknown" })).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(harness.latest().sent.length).toBe(before);
  });

  it("cancels generation promptly by terminating the worker", async () => {
    const harness = createHarness();
    const model = await load(harness.provider);
    const controller = new AbortController();
    const pending = model.generate({
      text: "a long passage",
      voiceId: "af_heart",
      signal: controller.signal,
    });
    await tick(); // let the request reach the worker and the listener attach

    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(harness.workers[0]!.terminated).toBe(true);
    expect(harness.provider.activeDevice).toBeNull();
  });

  it("respawns the worker transparently after cancellation", async () => {
    const harness = createHarness();
    const model = await load(harness.provider);

    const firstController = new AbortController();
    const first = model.generate({
      text: "cancelled one",
      voiceId: "af_heart",
      signal: firstController.signal,
    });
    await tick();
    firstController.abort();
    await expect(first).rejects.toMatchObject({ code: "cancelled" });

    const second = model.generate({ text: "second try", voiceId: "am_adam" });
    await tick();
    const respawned = harness.latest();
    expect(respawned).not.toBe(harness.workers[0]); // fresh worker spawned
    expect(respawned.sent.some((m) => m.kind === "load")).toBe(true); // reload issued

    respawned.reply({
      kind: "result",
      id: lastMessageId(respawned, "generate"),
      sampleRateHz: 24000,
      pcm: Float32Array.from([0.2, 0.3]),
    });
    const result = await second;
    expect(result.pcm.length).toBe(2);
  });

  it("aborts a model load before any worker is spawned", async () => {
    const workers: FakeWorker[] = [];
    const provider = new KokoroLocalProvider({
      workerFactory: () => {
        const worker = new FakeWorker(null);
        workers.push(worker);
        return worker;
      },
    });

    const controller = new AbortController();
    const pending = provider.load({ onProgress: () => {}, signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(workers).toHaveLength(0); // aborted before any work started
  });

  it("cancels a still-in-flight model load and terminates its worker", async () => {
    // deferLoad: worker exists but never answers the load request.
    const workers: FakeWorker[] = [];
    const provider = new KokoroLocalProvider({
      workerFactory: () => {
        const worker = new FakeWorker(null);
        workers.push(worker);
        return worker;
      },
    });

    const controller = new AbortController();
    const pending = provider.load({ onProgress: () => {}, signal: controller.signal });
    await tick(); // let the probe resolve, the worker spawn, and the request pend
    expect(workers.length).toBe(1);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(workers[0]!.terminated).toBe(true);
  });

  it("release acknowledges graceful disposal then stops the thread", async () => {
    const harness = createHarness();
    await load(harness.provider);
    const releasing = harness.provider.release();
    await tick();

    const worker = harness.latest();
    const releaseMessage = worker.sent.find((m) => m.kind === "release");
    expect(releaseMessage).toBeDefined();
    worker.reply({ kind: "released", id: releaseMessage!.id });

    await releasing;
    expect(worker.terminated).toBe(true);
    expect(harness.provider.activeDevice).toBeNull();
  });

  it("dispose before any load is a safe no-op", () => {
    const { provider } = createHarness();
    expect(() => provider.dispose()).not.toThrow();
  });

  it("isAvailable requires WebAssembly only (WebGPU is optional)", () => {
    const provider = new KokoroLocalProvider();
    expect(provider.isAvailable?.({ webAssembly: true, webgpu: true })).toBe(true);
    expect(provider.isAvailable?.({ webAssembly: true, webgpu: false })).toBe(true);
    expect(provider.isAvailable?.({ webAssembly: false, webgpu: true })).toBe(false);
  });

  it("returns null estimates until M3 benchmarking exists", () => {
    const provider = new KokoroLocalProvider();
    expect(
      provider.estimate({
        charCount: 100,
        device: { webgpuAvailable: true, cpuCores: 8, crossOriginIsolated: true },
      }),
    ).toBeNull();
  });
});
