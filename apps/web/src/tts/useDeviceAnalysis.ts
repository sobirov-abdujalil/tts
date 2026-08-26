/**
 * useDeviceAnalysis — orchestrates capability detection, the cached benchmark
 * lookup, and on-demand measurement of real generation speed.
 *
 * Privacy: everything here is local-only. Detection reads browser APIs, the
 * benchmark generates a fixed sentence through the local provider, and results
 * persist in localStorage via the engine's BenchmarkCache. Nothing is sent to
 * any server (guarded by the web source tests).
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  BENCHMARK_VERSION,
  KOKORO_Q8_DESCRIPTOR,
  describeDeviceSignature,
  detectDeviceProfile,
  detectInferenceEnvironment,
  getDefaultBenchmarkCache,
  localStorageStore,
  recommendModels,
  runTtsBenchmark,
  selectLocalRuntimePlan,
  writeStoredDeviceSignature,
  isTtsError,
  type CachedBenchmark,
  type DeviceProfile,
  type LoadedModel,
} from "@tts/tts-engine";
import { getAppTtsProvider } from "./providerSingleton.js";
import {
  deviceAnalysisReducer,
  initialDeviceAnalysisState,
  type DeviceAnalysisState,
} from "./deviceAnalysisState.js";

export interface UseDeviceAnalysis {
  state: DeviceAnalysisState;
  /** A fresh measurement would add information the card currently lacks. */
  needsMeasurement: boolean;
  /**
   * Run the short real-generation benchmark now. Reuses the app's loaded
   * model when one exists so no extra download/init is paid.
   */
  runMeasurement(): Promise<void>;
}

export function useDeviceAnalysis(getLoadedModel?: () => LoadedModel | null): UseDeviceAnalysis {
  const [state, dispatch] = useReducer(deviceAnalysisReducer, initialDeviceAnalysisState);
  const measuringRef = useRef(false);
  const profileRef = useRef<DeviceProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const provider = getAppTtsProvider();
      const env = detectInferenceEnvironment();
      if (provider.isAvailable !== undefined && !provider.isAvailable(env)) {
        dispatch({ type: "profile-unavailable" });
        return;
      }

      const profile = await detectDeviceProfile();
      if (cancelled) return;
      profileRef.current = profile;

      // Persist the signature so provider.estimate() can serve cached
      // measurements for exactly this device configuration (local-only).
      const store = localStorageStore();
      const signature = describeDeviceSignature(profile);
      writeStoredDeviceSignature(store, signature);

      const cache = getDefaultBenchmarkCache();
      const planPrimary = selectLocalRuntimePlan(profile).primary;
      const cached =
        planPrimary !== null
          ? cache.get({
              modelId: KOKORO_Q8_DESCRIPTOR.modelId,
              dtype: KOKORO_Q8_DESCRIPTOR.dtype,
              runtime: planPrimary,
              deviceSignature: signature,
            })
          : null;

      const [topRecommendation] = recommendModels({
        profile,
        benchmarks: cached ? [cached] : [],
      });

      dispatch({ type: "profile-ready", profile, benchmark: cached, recommendation: topRecommendation ?? null });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runMeasurement = useCallback(async (): Promise<void> => {
    if (measuringRef.current || profileRef.current === null) return;
    measuringRef.current = true;
    dispatch({ type: "measure-started" });

    try {
      const provider = getAppTtsProvider();
      // Reuse the warm session whenever possible — zero extra download/init.
      const reused = getLoadedModel?.() ?? null;
      const outcome = await runTtsBenchmark({
        provider,
        model: reused,
        config: { modelId: KOKORO_Q8_DESCRIPTOR.modelId, dtype: KOKORO_Q8_DESCRIPTOR.dtype },
      });

      if (!outcome.ok) {
        const message =
          outcome.code === "cancelled"
            ? "Speed measurement was cancelled."
            : `Speed measurement failed: ${outcome.message}`;
        dispatch({ type: "measure-failed", message });
        return;
      }

      const profile = profileRef.current!;
      const entry: CachedBenchmark = {
        benchmarkVersion: BENCHMARK_VERSION,
        modelId: KOKORO_Q8_DESCRIPTOR.modelId,
        dtype: KOKORO_Q8_DESCRIPTOR.dtype,
        runtime: outcome.runtimeUsed ?? "wasm",
        deviceSignature: describeDeviceSignature(profile),
        rtf: outcome.rtf,
        speedMultiplier: outcome.speedMultiplier,
        initMs: outcome.initMs,
        generationMs: outcome.generationMs,
        audioDurationSec: outcome.audioDurationSec,
        measuredAt: Date.now(),
      };
      getDefaultBenchmarkCache().put(entry);

      const [topRecommendation] = recommendModels({ profile, benchmarks: [entry] });
      dispatch({ type: "measure-completed", benchmark: entry, recommendation: topRecommendation ?? null });
    } catch (error) {
      dispatch({
        type: "measure-failed",
        message: isTtsError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : "Speed measurement failed unexpectedly.",
      });
    } finally {
      measuringRef.current = false;
    }
  }, [getLoadedModel]);

  return {
    state,
    needsMeasurement:
      state.phase === "ready" && state.benchmark === null && !state.measuring && state.measureError === null,
    runMeasurement,
  };
}
