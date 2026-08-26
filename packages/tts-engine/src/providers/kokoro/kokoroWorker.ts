/**
 * Kokoro inference worker entry (DECISIONS.md D-003).
 *
 * Runs inside a dedicated module Web Worker created by the provider. This is
 * the ONLY module in the workspace that imports kokoro-js. It contains no API
 * client code and never sends text or audio anywhere except back to the main
 * thread via postMessage — the privacy invariant holds structurally because
 * this bundle performs no I/O besides model-file downloads inside kokoro-js.
 */

import { KokoroTTS } from "kokoro-js";
import type {
  GenerateRequestPayload,
  LoadRequestPayload,
  MainToWorkerMessage,
  WorkerToMainMessage,
} from "./protocol.js";
import { classifyRuntimeError } from "../../errors.js";
import type { KokoroDevice } from "./config.js";

interface WorkerScope {
  onmessage: ((event: MessageEvent<MainToWorkerMessage>) => void) | null;
  postMessage(message: WorkerToMainMessage, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

interface LoadedSession {
  tts: KokoroTTS;
  device: KokoroDevice;
}

let session: LoadedSession | null = null;

/** Per-file download bookkeeping for aggregate load progress (0..1). */
const fileProgress = new Map<string, { loaded: number; total: number }>();

function reportLoadProgress(requestId: number): void {
  let loaded = 0;
  let total = 0;
  for (const entry of fileProgress.values()) {
    loaded += entry.loaded;
    total += entry.total;
  }
  if (total > 0) {
    const fraction = Math.max(0, Math.min(0.99, loaded / total));
    scope.postMessage({ kind: "load-progress", id: requestId, fraction });
  }
}

function makeProgressCallback(requestId: number) {
  return (event: unknown): void => {
    if (typeof event !== "object" || event === null) return;
    const info = event as { status?: string; file?: unknown; loaded?: number; total?: number };
    if (typeof info.file !== "string") return;
    // Only files with known sizes participate in the aggregate so one unknown
    // total cannot distort the percentage. Fully cached files may skip straight
    // to "done" without ever being tracked — harmless, ready follows shortly.
    if (
      info.status === "progress" &&
      typeof info.loaded === "number" &&
      typeof info.total === "number" &&
      info.total > 0
    ) {
      fileProgress.set(info.file, { loaded: info.loaded, total: info.total });
      reportLoadProgress(requestId);
    } else if (info.status === "done" && fileProgress.has(info.file)) {
      const previous = fileProgress.get(info.file)!;
      fileProgress.set(info.file, { loaded: previous.total, total: previous.total });
      reportLoadProgress(requestId);
    }
  };
}

function postError(id: number, error: unknown, prefix?: string): void {
  const classified = classifyRuntimeError(error);
  scope.postMessage({
    kind: "error",
    id,
    code: classified.code,
    message: prefix ? `${prefix} ${classified.message}` : classified.message,
  });
}

async function handleLoad(id: number, payload: LoadRequestPayload): Promise<void> {
  if (session) return; // idempotent within this worker's lifetime

  let lastError: unknown;
  for (const device of payload.devices) {
    console.warn(`[kokoro-worker] attempting device=${device}`);
    try {
      const tts = await KokoroTTS.from_pretrained(payload.modelId, {
        dtype: payload.dtype,
        device,
        progress_callback: makeProgressCallback(id),
      });
      session = { tts, device };
      scope.postMessage({ kind: "ready", id, device });
      return;
    } catch (error) {
      const stack = error instanceof Error ? error.stack : String(error);
      console.warn(`[kokoro-worker] device=${device} FAILED`, stack?.slice(0, 1500));
      lastError = error;
    }
  }

  postError(
    id,
    lastError ?? new Error("No execution device was available."),
    `Failed to load the speech model after trying ${payload.devices.length} execution option(s).`,
  );
}

async function handleGenerate(id: number, payload: GenerateRequestPayload): Promise<void> {
  if (!session) {
    scope.postMessage({
      kind: "error",
      id,
      code: "model-load-failed",
      message: "The speech model is not loaded yet.",
    });
    return;
  }
  try {
    // Voice ids are validated against our shared registry subset upstream;
    // kokoro-js narrows the key type internally.
    const options = { voice: payload.voiceId, speed: payload.speed } as Parameters<
      KokoroTTS["generate"]
    >[1];
    const audio = await session.tts.generate(payload.text, options);

    // Copy into a dedicated ArrayBuffer so it can be transferred (RawAudio may
    // hold a view into a larger buffer owned by the runtime).
    const pcm = audio.audio.slice();
    scope.postMessage({ kind: "result", id, sampleRateHz: audio.sampling_rate, pcm }, [pcm.buffer]);
  } catch (error) {
    postError(id, error);
  }
}

async function handleRelease(id: number): Promise<void> {
  if (session) {
    try {
      await session.tts.model.dispose();
    } catch {
      // Disposal failures are not user-actionable; drop the reference either way.
    }
    session = null;
  }
  scope.postMessage({ kind: "released", id });
}

/**
 * Transformers.js v3 persists model files in the browser Cache API under this
 * cache name. Deleting every request whose URL contains the repo path evicts
 * that model (weights AND its voice data, which ships in the same repo) so a
 * suspected-corrupted entry is re-fetched cleanly. Best-effort: failures still
 * reply `cache-cleared` — the subsequent network retry succeeds or fails on
 * its own terms.
 */
const TRANSFORMERS_JS_CACHE_NAME = "transformers-cache";

async function handleClearCache(
  id: number,
  payload: { modelId: string },
): Promise<void> {
  try {
    const cachesRef = (self as unknown as { caches?: CacheStorage }).caches;
    if (cachesRef && typeof cachesRef.open === "function") {
      const cache = await cachesRef.open(TRANSFORMERS_JS_CACHE_NAME);
      const requests = await cache.keys();
      await Promise.all(
        requests
          .filter((request) => request.url.includes(payload.modelId))
          .map((request) => cache.delete(request)),
      );
    }
  } catch {
    // Best-effort eviction; see docblock.
  }
  scope.postMessage({ kind: "cache-cleared", id });
}

scope.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const message = event.data;
  switch (message.kind) {
    case "load":
      handleLoad(message.id, message.payload).catch((error: unknown) => postError(message.id, error));
      break;
    case "generate":
      handleGenerate(message.id, message.payload).catch((error: unknown) =>
        postError(message.id, error),
      );
      break;
    case "release":
      void handleRelease(message.id);
      break;
    case "clear-cache":
      void handleClearCache(message.id, message.payload);
      break;
  }
};
