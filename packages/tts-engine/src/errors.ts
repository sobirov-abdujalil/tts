/**
 * Typed error taxonomy for TTS failures (ARCHITECTURE.md M3 error taxonomy,
 * pulled forward minimally for M2 so the UI can render precise copy).
 */

export const TTS_ERROR_CODES = [
  /** Device/runtime cannot run local inference at all (no WASM, ancient browser). */
  "unsupported-browser",
  /** Model download or initialization failed (network, corrupted cache, backend init). */
  "model-load-failed",
  /** Generation ran but failed (phonemizer/G2P, inference error). */
  "generation-failed",
  /** Runtime failure such as out-of-memory / context loss. */
  "runtime-failure",
  /** Work was cancelled by the user. */
  "cancelled",
  /** Caller passed invalid input (empty/too long text, unknown voice). */
  "invalid-input",
] as const;

export type TtsErrorCode = (typeof TTS_ERROR_CODES)[number];

export class TtsError extends Error {
  readonly code: TtsErrorCode;

  constructor(code: TtsErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "TtsError";
    this.code = code;
    if (options?.cause !== undefined) {
      // Standard `cause` support; assigned manually for older targets.
      Object.assign(this, { cause: options.cause });
    }
  }
}

export function isTtsError(value: unknown): value is TtsError {
  return value instanceof TtsError;
}

const OOM_PATTERN = /(out of memory|oom|allocation|cannot allocate|buffer is not big enough)/i;

/**
 * Best-effort classification of an unknown worker/runtime error into the
 * taxonomy. OOM-style failures are matched heuristically because ORT does not
 * expose a dedicated exception type.
 */
export function classifyRuntimeError(error: unknown): TtsError {
  if (isTtsError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (OOM_PATTERN.test(message)) {
    return new TtsError("runtime-failure", "The device ran out of memory during inference.", {
      cause: error,
    });
  }
  return new TtsError("runtime-failure", message || "Unknown runtime failure.", {
    cause: error,
  });
}
