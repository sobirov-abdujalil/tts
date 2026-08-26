/**
 * Estimation math shared by the recommendation card and UI copy.
 *
 * All outputs are ESTIMATES derived from a measured RTF on this device and
 * are labeled as such by the callers. Pure functions — no I/O.
 *
 *   rtf = generation_time / audio_duration      (lower is faster)
 *   estimated_time = target_audio_duration × rtf
 *   speed multiplier = audio_duration / generation_time   ("1.8× real time")
 */

export function isValidRtf(rtf: number): boolean {
  return Number.isFinite(rtf) && rtf > 0;
}

/** Estimated seconds to produce targetAudioSeconds of audio. null when unusable inputs. */
export function estimateGenerationSeconds(targetAudioSeconds: number, rtf: number): number | null {
  if (!Number.isFinite(targetAudioSeconds) || targetAudioSeconds <= 0 || !isValidRtf(rtf)) return null;
  return targetAudioSeconds * rtf;
}

/** "52s" · "3m 53s" · "1h 04m" — rounded, user-facing duration text. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const seconds = Math.round(totalSeconds);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) {
    return restSeconds > 0 ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}h ${String(restMinutes).padStart(2, "0")}m`;
}

/** "2.0× real time" style label from a speed multiplier. */
export function formatSpeedMultiplier(speedMultiplier: number): string {
  if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) return "—";
  const rounded = speedMultiplier >= 10 ? Math.round(speedMultiplier) : Math.round(speedMultiplier * 10) / 10;
  return `${rounded.toFixed(rounded >= 10 ? 0 : 1)}× real time`;
}
