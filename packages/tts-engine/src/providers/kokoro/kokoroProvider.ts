/**
 * Kokoro local provider — the first concrete TTSModelProvider (M2).
 *
 * Wraps kokoro-js inside a dedicated module Web Worker (DECISIONS.md D-003)
 * behind the provider abstraction in ../../index.js. The UI depends only on
 * the abstraction and the registry — never on this file.
 *
 * Lifecycle:
 *  - lazy: no worker/model exists until load() (first Generate)
 *  - cached: reloads hit the browser Cache API via transformers.js
 *  - cancellation: terminating the worker stops inference promptly (D-015);
 *    the next operation transparently respawns the worker and reloads
 *  - memory: one inference at a time (serialized); PCM buffers are transferred
 *    out of the worker instead of being copied
 */

import {
  BASIC_VOICES,
  DEFAULT_SPEED,
  MAX_INPUT_CHARS,
  SPEED_RANGE,
  findVoice,
  validateSynthesisText,
} from "@tts/shared";
import type {
  AudioResult,
  EstimateContext,
  LoadedModel,
  LoadOptions,
  SpeedEstimate,
  SynthesisInput,
  TTSModelProvider,
} from "../../index.js";
import { detectInferenceEnvironment, probeWebGPUAdapter } from "../../env.js";
import type { InferenceEnvironment } from "../../env.js";
import { TtsError, isTtsError } from "../../errors.js";
import type { KokoroDevice, KokoroLoadConfig } from "./config.js";
import { KOKORO_DEFAULT_LOAD_CONFIG } from "./config.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./protocol.js";

/** Minimal worker surface used by the client; injectable for tests. */
export interface WorkerHandle {
  postMessage(message: MainToWorkerMessage, transfer?: Transferable[]): void;
  terminate(): void;
  set onmessage(handler: ((event: MessageEvent<WorkerToMainMessage>) => void) | null);
}

export type WorkerFactory = () => WorkerHandle;

export function defaultKokoroWorkerFactory(): WorkerHandle {
  return new Worker(new URL("./kokoroWorker.ts", import.meta.url), { type: "module" });
}

export interface KokoroProviderOptions {
  workerFactory?: WorkerFactory;
  loadConfig?: KokoroLoadConfig;
  /**
   * Verifies WebGPU is genuinely usable before the provider offers it to the
   * worker. Defaults to a real `navigator.gpu.requestAdapter()` probe;
   * injectable for tests.
   */
  webgpuProbe?: () => Promise<boolean>;
}

interface PendingRequest<T> {
  resolve(value: T): void;
  reject(error: TtsError): void;
}

const RELEASE_ACK_TIMEOUT_MS = 5_000;

function cancelledError(): TtsError {
  return new TtsError("cancelled", "Generation was cancelled.");
}

/** Only genuine load failures (bad device/backend/download) allow the next candidate. */
function isLoadFailure(error: unknown): error is TtsError {
  return isTtsError(error) && error.code === "model-load-failed";
}

function clampSpeed(speed: number | undefined): number {
  const value = speed ?? DEFAULT_SPEED;
  if (!Number.isFinite(value)) return DEFAULT_SPEED;
  return Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, value));
}

/** LoadedModel view over a provider instance (delegates into its lifecycle). */
class KokoroLoadedModel implements LoadedModel {
  constructor(private readonly provider: KokoroLocalProvider) {}

  generate(input: SynthesisInput): Promise<AudioResult> {
    return this.provider.generate(input);
  }

  release(): Promise<void> {
    return this.provider.release();
  }

  get activeDevice(): "webgpu" | "wasm" | null {
    return this.provider.activeDevice;
  }
}

export class KokoroLocalProvider implements TTSModelProvider {
  static readonly ID = "kokoro-local";

  readonly id = KokoroLocalProvider.ID;
  readonly kind = "local" as const;
  readonly capabilities = {
    voices: BASIC_VOICES.map((voice) => ({
      id: voice.id,
      name: voice.name,
      language: voice.language,
      gender: voice.gender,
    })),
    speedRange: SPEED_RANGE,
    supportsEmotion: false,
    maxCharsPerRequest: MAX_INPUT_CHARS,
  } as const;

  private readonly workerFactory: WorkerFactory;
  private readonly loadConfig: KokoroLoadConfig;
  private readonly webgpuProbe: () => Promise<boolean>;

  private worker: WorkerHandle | null = null;
  private readonly pending = new Map<number, PendingRequest<unknown>>();
  private nextRequestId = 1;
  private loadedDevice: KokoroDevice | null = null;
  private loadPromise: Promise<KokoroDevice> | null = null;
  private progressListener: ((fraction: number) => void) | null = null;
  private queueTail: Promise<unknown> = Promise.resolve();

  constructor(options: KokoroProviderOptions = {}) {
    this.workerFactory = options.workerFactory ?? defaultKokoroWorkerFactory;
    this.loadConfig = options.loadConfig ?? KOKORO_DEFAULT_LOAD_CONFIG;
    this.webgpuProbe = options.webgpuProbe ?? probeWebGPUAdapter;
  }

  /** Local inference requires WebAssembly; WebGPU is an optional accelerator. */
  isAvailable(env: InferenceEnvironment = detectInferenceEnvironment()): boolean {
    return env.webAssembly;
  }

  /**
   * Rough speed estimates wait for the M3 micro-benchmark (ARCHITECTURE.md §4.3);
   * honest null beats made-up numbers.
   */
  estimate(_ctx: EstimateContext): SpeedEstimate | null {
    return null;
  }

  async load(opts: LoadOptions): Promise<LoadedModel> {
    await this.ensureLoaded(opts);
    return new KokoroLoadedModel(this);
  }

  /** Public generate entry — serializes inference (one at a time). */
  generate(input: SynthesisInput): Promise<AudioResult> {
    return this.runExclusive(() => this.generateLocked(input));
  }

  /** Terminate everything immediately (worker included). Safe to call twice. */
  dispose(): void {
    this.terminateWorker();
  }

  /** Device the model currently runs on; null before/at load failure. */
  get activeDevice(): KokoroDevice | null {
    return this.loadedDevice;
  }

  // ---- public surface internals -------------------------------------------

  /**
   * Ensure the worker exists and the model is loaded. Concurrent callers share
   * one in-flight load; progress events go to the most recent listener.
   */
  private ensureLoaded(opts?: Partial<LoadOptions>): Promise<KokoroDevice> {
    if (this.loadedDevice !== null && this.worker !== null) {
      return Promise.resolve(this.loadedDevice);
    }

    if (opts?.onProgress) this.progressListener = opts.onProgress;

    if (!this.loadPromise) {
      // Thread the triggering caller's signal into the attempt loop as well,
      // so aborting before/between worker spawns stops the load promptly;
      // later callers' aborts keep working through their own listeners below.
      this.loadPromise = this.doLoad(opts?.signal).finally(() => {
        this.loadPromise = null;
      });
    }

    if (opts?.signal) {
      const { signal } = opts;
      if (signal.aborted) throw cancelledError();
      const onAbort = (): void => this.terminateWorker();
      signal.addEventListener("abort", onAbort, { once: true });
      return this.loadPromise.finally(() => signal.removeEventListener("abort", onAbort));
    }

    return this.loadPromise;
  }

  private doLoad(signal?: AbortSignal): Promise<KokoroDevice> {
    return this.resolveCandidateDevices().then((devices) =>
      this.loadOnFirstWorkingDevice(devices, signal),
    );
  }

  /**
   * Devices worth attempting, in preference order. WebGPU candidates are
   * dropped unless a real adapter probe passes — `navigator.gpu` alone is not
   * proof (headless/soft-blocked environments), and a doomed GPU attempt must
   * never delay generation.
   */
  private async resolveCandidateDevices(): Promise<KokoroDevice[]> {
    const candidates: KokoroDevice[] = [];
    for (const device of this.loadConfig.devicePreference) {
      if (device === "webgpu" && !(await this.webgpuProbe())) continue;
      candidates.push(device);
    }
    // WASM is the floor: every browser that passes isAvailable() can run it.
    return candidates.length > 0 ? candidates : ["wasm"];
  }

  /**
   * Try each candidate on its OWN fresh worker. A failed attempt terminates
   * its worker before the next attempt starts, so no poisoned ORT/backend
   * state can leak between attempts (observed: after a failed WebGPU session
   * creation, retrying inside the same worker also failed). On success the
   * surviving worker stays loaded for generation.
   */
  private async loadOnFirstWorkingDevice(
    devices: readonly KokoroDevice[],
    signal?: AbortSignal,
  ): Promise<KokoroDevice> {
    let lastError: unknown = new TtsError(
      "model-load-failed",
      "No execution device was available.",
    );

    for (const device of devices) {
      if (signal?.aborted) throw cancelledError();
      this.terminateWorker(); // discard any failed-attempt worker state
      this.spawnWorker();
      const id = this.nextRequestId++;
      const message: MainToWorkerMessage = {
        kind: "load",
        id,
        payload: {
          modelId: this.loadConfig.modelId,
          dtype: this.loadConfig.dtype,
          devices: [device],
        },
      };
      try {
        return await this.request<KokoroDevice>(id, message);
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw cancelledError();
        if (!isLoadFailure(error)) throw error;
      }
    }

    throw lastError;
  }

  /** Runs inside runExclusive — validates input, ensures model, dispatches. */
  private generateLocked(input: SynthesisInput): Promise<AudioResult> {
    const validation = validateSynthesisText(input.text);
    if (!validation.valid) {
      throw new TtsError("invalid-input", validation.message);
    }
    const voice = findVoice(input.voiceId);
    if (!voice) {
      throw new TtsError("invalid-input", `Unknown voice "${input.voiceId}".`);
    }
    const speed = clampSpeed(input.speed);
    const signal = input.signal;
    const precheck = this.ensureLoaded(signal ? { signal } : undefined);
    if (signal?.aborted) throw cancelledError();

    return precheck.then(() => {
      if (signal?.aborted) throw cancelledError();
      const id = this.nextRequestId++;
      const message: MainToWorkerMessage = {
        kind: "generate",
        id,
        payload: { text: input.text.trim(), voiceId: voice.id, speed },
      };
      const promise = this.request<AudioResult>(id, message);
      if (!signal) return promise;

      const onAbort = (): void => this.terminateWorker();
      signal.addEventListener("abort", onAbort, { once: true });
      return promise.finally(() => signal.removeEventListener("abort", onAbort));
    });
  }

  /** Graceful release: dispose ONNX sessions in-worker, then stop the thread. */
  async release(): Promise<void> {
    if (!this.worker) return;
    const id = this.nextRequestId++;
    try {
      await Promise.race([
        this.request<undefined>(id, { kind: "release", id }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(cancelledError()), RELEASE_ACK_TIMEOUT_MS),
        ),
      ]);
    } catch {
      // Timeout or rejection: fall through and hard-stop regardless.
    } finally {
      this.terminateWorker();
    }
  }

  // ---- worker plumbing ------------------------------------------------------

  private spawnWorker(): WorkerHandle {
    if (this.worker) return this.worker;
    const worker = this.workerFactory();
    worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
      this.handleWorkerMessage(event.data);
    };
    this.worker = worker;
    return worker;
  }

  private requireWorker(): WorkerHandle {
    if (!this.worker) {
      throw new TtsError("model-load-failed", "The inference worker is not running.");
    }
    return this.worker;
  }

  /**
   * Send a request and await its correlated reply. Resolution values are
   * produced by handleWorkerMessage, the single place mapping reply kinds to
   * caller-facing types.
   */
  private request<T>(id: number, message: MainToWorkerMessage): Promise<T> {
    const worker = this.requireWorker();
    return new Promise<T>((resolve, reject) => {
      const settle = (fn: () => void): void => {
        this.pending.delete(id);
        fn();
      };
      this.pending.set(id, {
        resolve: (value) => settle(() => resolve(value as T)),
        reject: (error) => settle(() => reject(error)),
      });
      try {
        worker.postMessage(message);
      } catch (error) {
        settle(() =>
          reject(
            new TtsError("runtime-failure", "Failed to dispatch work to the inference worker.", {
              cause: error,
            }),
          ),
        );
      }
    });
  }

  private handleWorkerMessage(message: WorkerToMainMessage): void {
    if (message.kind === "load-progress") {
      this.progressListener?.(message.fraction);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return; // stale reply from a superseded request/worker

    switch (message.kind) {
      case "ready":
        this.loadedDevice = message.device;
        pending.resolve(message.device);
        break;
      case "result":
        pending.resolve({ sampleRateHz: message.sampleRateHz, pcm: message.pcm });
        break;
      case "released":
        pending.resolve(undefined);
        break;
      case "error":
        pending.reject(new TtsError(message.code, message.message));
        break;
    }
  }

  private terminateWorker(): void {
    const worker = this.worker;
    this.worker = null;
    this.loadedDevice = null;
    for (const pending of [...this.pending.values()]) {
      pending.reject(cancelledError());
    }
    this.pending.clear();
    worker?.terminate();
  }

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queueTail.then(task, task);
    this.queueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
