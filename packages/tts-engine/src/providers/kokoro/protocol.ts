/**
 * Typed message protocol between the main thread and the Kokoro inference
 * worker (DECISIONS.md D-003). Pure types + guards — importable from Node
 * tests without pulling in kokoro-js.
 *
 * Cancellation note (M2): there is no worker-side "cancel" message. kokoro-js
 * exposes no per-chunk abort hook for single-shot generation, so cancellation
 * is enforced by the client terminating the worker (prompt stop) and
 * respawning it on next use; the model then reloads from cache. Revisit when
 * long-text chunked generation lands in M3 — cooperative abort between chunks
 * becomes possible there.
 */

import type { TtsErrorCode } from "../../errors.js";
import type { KokoroDevice, KokoroDtype } from "./config.js";

export const WORKER_PROTOCOL_VERSION = 1;

export interface LoadRequestPayload {
  modelId: string;
  dtype: KokoroDtype;
  /** Devices to try, in order of preference. */
  devices: readonly KokoroDevice[];
}

export interface GenerateRequestPayload {
  text: string;
  voiceId: string;
  speed: number;
}

export type MainToWorkerMessage =
  | { kind: "load"; id: number; payload: LoadRequestPayload }
  | { kind: "generate"; id: number; payload: GenerateRequestPayload }
  | { kind: "release"; id: number };

export type WorkerToMainMessage =
  | { kind: "load-progress"; id: number; fraction: number }
  | { kind: "ready"; id: number; device: KokoroDevice }
  | { kind: "result"; id: number; sampleRateHz: number; pcm: Float32Array }
  | { kind: "released"; id: number }
  | { kind: "error"; id: number; code: TtsErrorCode; message: string };

const MAIN_KINDS = new Set(["load", "generate", "release"]);

/** Structural guard for messages arriving at the worker. */
export function isMainToWorkerMessage(value: unknown): value is MainToWorkerMessage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "number" && MAIN_KINDS.has(candidate.kind as string);
}
