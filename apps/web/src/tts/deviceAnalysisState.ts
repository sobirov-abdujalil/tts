/**
 * Pure state machine for the device analysis card (M3).
 *
 * Mirrors the ttsState.ts pattern: transitions are unit-testable in Node; the
 * hook (useDeviceAnalysis.ts) performs the async detection/measurement work
 * and translates results into these events.
 *
 * Honesty: measured values come only from a cached/real benchmark on this
 * device. Without one, the card shows capability facts and offers to measure.
 */

import type { DeviceProfile, Recommendation, CachedBenchmark } from "@tts/tts-engine";

export type DeviceAnalysisPhase = "checking" | "unsupported" | "ready";

export interface DeviceAnalysisState {
  phase: DeviceAnalysisPhase;
  profile: DeviceProfile | null;
  recommendation: Recommendation | null;
  /** Valid cached measurement for the recommended model+runtime, if any. */
  benchmark: CachedBenchmark | null;
  measuring: boolean;
  measureError: string | null;
}

export type DeviceAnalysisEvent =
  | { type: "profile-ready"; profile: DeviceProfile; benchmark: CachedBenchmark | null; recommendation: Recommendation | null }
  | { type: "profile-unavailable" }
  | { type: "measure-started" }
  | { type: "measure-completed"; benchmark: CachedBenchmark; recommendation: Recommendation | null }
  | { type: "measure-failed"; message: string };

export const initialDeviceAnalysisState: DeviceAnalysisState = {
  phase: "checking",
  profile: null,
  recommendation: null,
  benchmark: null,
  measuring: false,
  measureError: null,
};

export function deviceAnalysisReducer(
  state: DeviceAnalysisState,
  event: DeviceAnalysisEvent,
): DeviceAnalysisState {
  switch (event.type) {
    case "profile-ready":
      return {
        ...state,
        phase: "ready",
        profile: event.profile,
        benchmark: event.benchmark,
        recommendation: event.recommendation,
      };

    case "profile-unavailable":
      return { ...state, phase: "unsupported" };

    case "measure-started":
      return { ...state, measuring: true, measureError: null };

    case "measure-completed":
      return {
        ...state,
        measuring: false,
        benchmark: event.benchmark,
        recommendation: event.recommendation ?? state.recommendation,
      };

    case "measure-failed":
      return { ...state, measuring: false, measureError: event.message };
  }
}
