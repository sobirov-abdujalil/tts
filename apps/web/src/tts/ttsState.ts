/**
 * Pure UI state machine for the TTS workspace (M2).
 *
 * Kept separate from React so transitions are unit-testable in Node without a
 * DOM. The hook (useLocalTts.ts) translates engine/provider events into these
 * actions and owns side effects (object URLs, abort controllers).
 */

import type { TtsErrorCode } from "@tts/tts-engine";

export type TtsPhase =
  | "checking" // probing whether local inference is possible
  | "unsupported" // device cannot run local inference
  | "idle" // ready to generate; model not loaded yet
  | "loading-model" // downloading/initializing the model (first generation)
  | "generating"
  | "ready"; // model loaded, audio available or awaiting more input

export interface TtsErrorState {
  code: TtsErrorCode;
  message: string;
}

export interface TtsUiState {
  phase: TtsPhase;
  /** Model download progress 0..1 while loading-model; null otherwise. */
  progress: number | null;
  activeDevice: "webgpu" | "wasm" | null;
  error: TtsErrorState | null;
  audioUrl: string | null;
  audioBytes: number | null;
}

export type TtsUiEvent =
  | { type: "env-checked"; supported: boolean }
  | { type: "generate-requested"; needsModel: boolean }
  | { type: "load-progress"; fraction: number }
  | { type: "model-ready"; device: "webgpu" | "wasm" | null }
  | { type: "generation-succeeded"; url: string; bytes: number }
  | { type: "operation-failed"; code: TtsErrorCode; message: string }
  | { type: "operation-cancelled" }
  | { type: "error-dismissed" };

export const initialTtsUiState: TtsUiState = {
  phase: "checking",
  progress: null,
  activeDevice: null,
  error: null,
  audioUrl: null,
  audioBytes: null,
};

/** Phase to settle on after an interrupted operation, given what is loaded. */
function settledPhase(state: TtsUiState): TtsUiState["phase"] {
  return state.activeDevice === null ? "idle" : "ready";
}

export function ttsUiReducer(state: TtsUiState, event: TtsUiEvent): TtsUiState {
  switch (event.type) {
    case "env-checked":
      return event.supported ? { ...state, phase: "idle" } : { ...state, phase: "unsupported" };

    case "generate-requested":
      if (state.phase === "unsupported") return state;
      return {
        ...state,
        phase: event.needsModel ? "loading-model" : "generating",
        progress: event.needsModel ? 0 : null,
        error: null,
      };

    case "load-progress":
      if (state.phase !== "loading-model") return state;
      return { ...state, progress: clampFraction(event.fraction) };

    case "model-ready":
      if (state.phase !== "loading-model") {
        return { ...state, activeDevice: event.device };
      }
      return { ...state, phase: "generating", activeDevice: event.device, progress: null };

    case "generation-succeeded":
      return {
        ...state,
        phase: "ready",
        progress: null,
        error: null,
        audioUrl: event.url,
        audioBytes: event.bytes,
      };

    case "operation-failed":
      if (state.phase === "unsupported" || state.phase === "checking") return state;
      return {
        ...state,
        phase: settledPhase(state),
        progress: null,
        error: { code: event.code, message: event.message },
      };

    case "operation-cancelled":
      if (state.phase === "unsupported" || state.phase === "checking") return state;
      return { ...state, phase: settledPhase(state), progress: null };

    case "error-dismissed":
      return { ...state, error: null };
  }
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
