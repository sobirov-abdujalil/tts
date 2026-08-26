/**
 * Model recommendation engine (ROADMAP.md M3).
 *
 *   DeviceProfile + ModelDescriptor(s) + BenchmarkResult(s) + UserRequirements
 *   → ordered Recommendation[]
 *
 * Framework-agnostic and UI-independent: the React card is one possible
 * consumer. Future local models (Piper, …) register a ModelDescriptor and are
 * recommended automatically — no changes here.
 *
 * Honesty rules: `confidence` reflects how much real data backed the pick.
 * Without a benchmark for this exact model+runtime+device we report
 * confidence "unknown" and never fabricate an RTF.
 */

import type { DeviceProfile } from "../device/deviceProfile.js";
import { selectLocalRuntimePlan } from "../runtime/runtimeSelection.js";
import type { CachedBenchmark } from "../benchmark/benchmarkCache.js";
import { describeDeviceSignature } from "../device/deviceProfile.js";
import { listModels } from "./models.js";
import type { ModelDescriptor } from "./models.js";

/** What the user cares about today (abstraction only — no premium features yet). */
export type UserIntent = "quality" | "speed" | "privacy-local" | "expressive";

export interface UserRequirements {
  intent: UserIntent;
}

export interface Recommendation {
  descriptor: ModelDescriptor;
  /** Best runtime to attempt for this model on this device. */
  runtime: "webgpu" | "wasm" | null;
  /** measured = backed by a cached benchmark on THIS device. */
  confidence: "measured" | "unknown";
  /** From the matched benchmark; null when unmeasured. Never invented. */
  estimatedRealtimeFactor: number | null;
  /** Honest human-readable justifications (safe to show users). */
  reasons: string[];
  supported: boolean;
  unsupportedReason: string | null;
}

export interface RecommendInput {
  profile: DeviceProfile;
  /** Valid cached benchmarks (already policy-filtered) for this device. */
  benchmarks?: readonly CachedBenchmark[] | undefined;
  requirements?: UserRequirements | undefined;
}

const QUALITY_RANK: Record<ModelDescriptor["qualityCategory"], number> = {
  draft: 1,
  good: 2,
  high: 3,
};

function matchBenchmark(
  descriptor: ModelDescriptor,
  runtime: NonNullable<Recommendation["runtime"]>,
  profile: DeviceProfile,
  benchmarks: readonly CachedBenchmark[] | undefined,
): CachedBenchmark | null {
  if (!benchmarks) return null;
  const signature = describeDeviceSignature(profile);
  let best: CachedBenchmark | null = null;
  for (const entry of benchmarks) {
    if (
      entry.modelId === descriptor.modelId &&
      entry.dtype === descriptor.dtype &&
      entry.runtime === runtime &&
      entry.deviceSignature === signature &&
      Number.isFinite(entry.rtf) &&
      entry.rtf > 0
    ) {
      if (best === null || entry.measuredAt > best.measuredAt) best = entry;
    }
  }
  return best;
}

function evaluateModel(
  descriptor: ModelDescriptor,
  input: RecommendInput,
  webgpuCandidateAvailable: boolean,
): Recommendation {
  const { profile } = input;
  const reasons: string[] = [];

  // --- eligibility ---------------------------------------------------------
  if ((descriptor.minRequirements.requiresWasm ?? true) && !profile.webAssembly.supported) {
    return {
      descriptor,
      runtime: null,
      confidence: "unknown",
      estimatedRealtimeFactor: null,
      reasons: [],
      supported: false,
      unsupportedReason: "This browser cannot run WebAssembly models.",
    };
  }

  const minThreads = descriptor.minRequirements.minCpuThreads;
  if (minThreads !== undefined && profile.cpuThreads.value !== null && profile.cpuThreads.value < minThreads) {
    return {
      descriptor,
      runtime: null,
      confidence: "unknown",
      estimatedRealtimeFactor: null,
      reasons: [],
      supported: false,
      unsupportedReason: `This model asks for at least ${minThreads} CPU threads.`,
    };
  }

  if (
    descriptor.minRequirements.requiresCrossOriginIsolation === true &&
    profile.crossOriginIsolated.value !== true
  ) {
    return {
      descriptor,
      runtime: null,
      confidence: "unknown",
      estimatedRealtimeFactor: null,
      reasons: [],
      supported: false,
      unsupportedReason: "This model needs cross-origin isolation, which this page does not have.",
    };
  }

  // --- runtime choice ------------------------------------------------------
  const runtimes: Array<"webgpu" | "wasm"> = [];
  for (const candidate of descriptor.executionRuntimes) {
    if (candidate === "webgpu") {
      if (profile.webAssembly.supported && webgpuCandidateAvailable) runtimes.push("webgpu");
    } else if (profile.webAssembly.supported) {
      runtimes.push("wasm");
    }
  }
  const runtime = runtimes[0] ?? null;

  // --- measurement ----------------------------------------------------------
  const benchmark = runtime !== null ? matchBenchmark(descriptor, runtime, profile, input.benchmarks) : null;
  if (benchmark) {
    reasons.push(`Measured on this device at ${benchmark.speedMultiplier.toFixed(1)}× real time.`);
  } else {
    reasons.push("Speed has not been measured on this device yet.");
  }

  reasons.push("Runs entirely in your browser — your text stays on your device.");
  if (!descriptor.supportsEmotion) {
    reasons.push("Expressive/emotion tags are not supported by this model.");
  }
  if (descriptor.expectedDownloadBytes !== null) {
    const mb = Math.round(descriptor.expectedDownloadBytes / (1024 * 1024));
    reasons.push(`One-time download of about ${mb} MB, cached afterwards.`);
  }

  return {
    descriptor,
    runtime,
    confidence: benchmark ? "measured" : "unknown",
    estimatedRealtimeFactor: benchmark ? benchmark.rtf : null,
    reasons,
    supported: runtime !== null,
    unsupportedReason: runtime === null ? "No compatible execution runtime on this device." : null,
  };
}

function sortKey(recommendation: Recommendation, intent: UserIntent): [number, number, number] {
  const rtfPenalty =
    recommendation.estimatedRealtimeFactor !== null ? recommendation.estimatedRealtimeFactor : Number.POSITIVE_INFINITY;
  const support = recommendation.supported ? 0 : 1;

  switch (intent) {
    case "speed":
      // Fastest measured first; unmeasured last; smaller download as tiebreak.
      return [
        support,
        rtfPenalty,
        recommendation.descriptor.expectedDownloadBytes ?? Number.MAX_SAFE_INTEGER,
      ];
    case "quality":
      return [support, -QUALITY_RANK[recommendation.descriptor.qualityCategory], rtfPenalty];
    case "expressive":
      // Prefer models with emotion support; none exist locally yet, so this
      // degrades gracefully and keeps the door open for future providers.
      return [support, recommendation.descriptor.supportsEmotion ? 0 : 1, rtfPenalty];
    case "privacy-local":
      // All current models are local; prefer the smallest download.
      return [support, recommendation.descriptor.expectedDownloadBytes ?? Number.MAX_SAFE_INTEGER, rtfPenalty];
  }
}

/**
 * Rank every registered model for this device. Always returns ALL registered
 * models (supported ones first per intent) so callers can explain fallbacks.
 */
export function recommendModels(input: RecommendInput): Recommendation[] {
  const plan = selectLocalRuntimePlan(input.profile);
  const requirements = input.requirements ?? { intent: "quality" };

  const recommendations = listModels().map((descriptor) =>
    evaluateModel(descriptor, input, plan.webgpuState === "available"),
  );

  const keyOf = (recommendation: Recommendation): [number, number, number] =>
    sortKey(recommendation, requirements.intent);

  return recommendations.sort(
    (a, b) =>
      keyOf(a)[0] - keyOf(b)[0] || keyOf(a)[1] - keyOf(b)[1] || keyOf(a)[2] - keyOf(b)[2],
  );
}

