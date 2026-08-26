/**
 * DeviceAnalysisCard — plain-language device analysis for the workspace
 * (PRODUCT_SPEC.md §6.3, ROADMAP.md M3).
 *
 * Shows: the recommended local model, which execution mode will be used, a
 * MEASURED speed (only when a real benchmark exists for this exact device),
 * and an estimate derived from that measurement. Everything is labeled as an
 * estimate because it is one. No jargon (ONNX/WebGPU/WASM) reaches this card.
 */

import {
  KOKORO_Q8_DESCRIPTOR,
  estimateGenerationSeconds,
  formatDuration,
  formatSpeedMultiplier,
  selectLocalRuntimePlan,
} from "@tts/tts-engine";
import type { UseDeviceAnalysis } from "../tts/useDeviceAnalysis.js";

/** Reference target for the "how long would X take" line: 7 minutes of audio. */
const REFERENCE_TARGET_SECONDS = 420;
const REFERENCE_TARGET_LABEL = "7 minutes";

export function DeviceAnalysisCard({
  analysis,
}: {
  analysis: UseDeviceAnalysis;
}) {
  const { state } = analysis;

  if (state.phase === "checking") {
    return (
      <section data-testid="device-card" className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        Checking your device…
      </section>
    );
  }

  if (state.phase === "unsupported") {
    return (
      <section data-testid="device-card" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        This browser can't run on-device speech generation.
      </section>
    );
  }

  const recommendation = state.recommendation;
  const benchmark = state.benchmark;
  const estimatedSeconds =
    benchmark !== null ? estimateGenerationSeconds(REFERENCE_TARGET_SECONDS, benchmark.rtf) : null;
  const modelName = recommendation?.descriptor.displayName ?? KOKORO_Q8_DESCRIPTOR.displayName;
  const userExplanation = state.profile !== null ? selectLocalRuntimePlan(state.profile).userExplanation : null;

  return (
    <section
      data-testid="device-card"
      aria-label="Device analysis"
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 text-sm shadow-sm"
    >
      {recommendation !== null && (
        <p className="font-semibold text-gray-800" data-testid="recommendation">
          Recommended: {modelName} — Local
        </p>
      )}

      {userExplanation !== null && (
        <p data-testid="mode-note" className="text-gray-600">
          {userExplanation}
        </p>
      )}

      {benchmark !== null ? (
        <>
          <p data-testid="measured-speed" className="text-gray-700">
            Measured on this device:{" "}
            <span className="font-medium">{formatSpeedMultiplier(benchmark.speedMultiplier)}</span>
          </p>
          {estimatedSeconds !== null && (
            <p data-testid="time-estimate" className="text-gray-600">
              Estimated time for {REFERENCE_TARGET_LABEL} of audio: ≈ {formatDuration(estimatedSeconds)}
              <span className="ml-1 text-xs text-gray-400">(estimate — actual time varies with your text)</span>
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-gray-500">Want to know how fast your device generates speech?</p>
          <div>
            {state.measuring ? (
              <span data-testid="measuring-status" className="inline-flex items-center gap-2 text-gray-600">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"
                />
                Measuring…
              </span>
            ) : (
              <button
                type="button"
                data-testid="run-benchmark-btn"
                onClick={() => void analysis.runMeasurement()}
                className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
              >
                Measure my device's speed
              </button>
            )}
          </div>
        </div>
      )}

      {state.measureError !== null && (
        <p role="alert" data-testid="measure-error" className="text-xs text-red-600">
          {state.measureError}
        </p>
      )}

      <p data-testid="privacy-line" className="text-xs text-gray-500">
        Generation happens on your device.
      </p>
    </section>
  );
}
