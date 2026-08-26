/**
 * useLocalTts — the only bridge between the workspace UI and the inference
 * engine. The UI never touches provider/worker internals; it sees phases,
 * progress, errors, and an audio object URL.
 *
 * Privacy: text flows exclusively from the editor into provider.generate();
 * nothing here performs network I/O (guarded by engine + web source tests).
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  detectInferenceEnvironment,
  getPreferredLocalProvider,
  isTtsError,
  type LoadedModel,
  type TTSModelProvider,
  type TtsErrorCode,
} from "@tts/tts-engine";
import { WAV_MIME_TYPE, encodeWavPcm16 } from "@tts/audio";
import { validateSynthesisText } from "@tts/shared";
import { initialTtsUiState, ttsUiReducer, type TtsUiState } from "./ttsState.js";

export interface UseLocalTts {
  state: TtsUiState;
  generate(text: string, voiceId: string): Promise<void>;
  cancel(): void;
  dismissError(): void;
}

export function useLocalTts(): UseLocalTts {
  const [state, dispatch] = useReducer(ttsUiReducer, initialTtsUiState);

  const providerRef = useRef<TTSModelProvider | null>(null);
  const modelRef = useRef<LoadedModel | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  // Environment probe once on mount; dispose the provider on unmount.
  useEffect(() => {
    const provider = getPreferredLocalProvider();
    providerRef.current = provider;
    dispatch({
      type: "env-checked",
      supported: provider.isAvailable?.(detectInferenceEnvironment()) ?? true,
    });
    return () => {
      abortRef.current?.abort();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      provider.dispose?.();
    };
  }, []);

  const revokeCurrentAudio = useCallback((): void => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const generate = useCallback(
    async (text: string, voiceId: string): Promise<void> => {
      if (busyRef.current) return;

      const validation = validateSynthesisText(text);
      if (!validation.valid) {
        dispatch({
          type: "operation-failed",
          code: "invalid-input",
          message: validation.message,
        });
        return;
      }

      const provider = providerRef.current;
      if (!provider) return;

      busyRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: "generate-requested", needsModel: modelRef.current === null });

      try {
        if (!modelRef.current) {
          modelRef.current = await provider.load({
            onProgress: (fraction) =>
              dispatch({ type: "load-progress", fraction }),
            signal: controller.signal,
          });
        }
        dispatch({ type: "model-ready", device: modelRef.current.activeDevice ?? null });

        const result = await modelRef.current.generate({
          text,
          voiceId,
          signal: controller.signal,
        });

        const bytes = encodeWavPcm16(result.pcm, result.sampleRateHz);
        // The encoder always allocates a dedicated ArrayBuffer.
        const buffer = bytes.buffer as ArrayBuffer;
        const url = URL.createObjectURL(new Blob([buffer], { type: WAV_MIME_TYPE }));
        revokeCurrentAudio();
        audioUrlRef.current = url;
        dispatch({ type: "generation-succeeded", url, bytes: bytes.byteLength });
      } catch (error) {
        const code: TtsErrorCode = isTtsError(error) ? error.code : "runtime-failure";
        if (code === "cancelled") {
          dispatch({ type: "operation-cancelled" });
        } else {
          dispatch({
            type: "operation-failed",
            code,
            message:
              isTtsError(error)
                ? error.message
                : error instanceof Error
                  ? error.message
                  : "Something went wrong while generating speech.",
          });
        }
      } finally {
        abortRef.current = null;
        busyRef.current = false;
      }
    },
    [revokeCurrentAudio],
  );

  const cancel = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  const dismissError = useCallback((): void => {
    dispatch({ type: "error-dismissed" });
  }, []);

  return { state, generate, cancel, dismissError };
}
