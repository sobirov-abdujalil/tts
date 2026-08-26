/**
 * Model download tracking + corrupted-cache recovery policy (ROADMAP.md M3 —
 * model download optimization).
 *
 * Transformers.js caches model files in the browser Cache API. That cache can
 * end up incomplete or corrupted (killed tab mid-download, evicted entries,
 * disk issues). We cannot inspect transformers.js internals, but we CAN know:
 *  - whether a load of this model+dtype ever fully succeeded before
 *    ("the cache should be warm"), and
 *  - that a fresh load attempt just failed with a load error anyway.
 *
 * That combination is our corruption signal: clear every cached request for
 * the model's repo path and retry ONCE from the network. A first-ever failure
 * (no record) is treated as network/GPU trouble — clearing would be pointless.
 *
 * Records live in localStorage via the shared KeyValueStore abstraction.
 */

import type { KeyValueStore } from "../benchmark/benchmarkCache.js";

export const DOWNLOAD_RECORD_KEY = "tts.model.downloads.v1";

export interface DownloadRecord {
  /** Epoch ms of the last fully successful load. */
  at: number;
}

export function readDownloadRecord(
  store: KeyValueStore | null,
  modelKey: string,
): DownloadRecord | null {
  if (!store) return null;
  try {
    const raw = store.getItem(DOWNLOAD_RECORD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entry = parsed?.[modelKey];
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { at?: unknown }).at === "number"
    ) {
      return { at: (entry as { at: number }).at };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeDownloadRecord(store: KeyValueStore | null, modelKey: string): void {
  if (!store) return;
  let file: Record<string, { at: number }> = {};
  try {
    const raw = store.getItem(DOWNLOAD_RECORD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, { at: number }>;
      if (parsed && typeof parsed === "object") file = parsed;
    }
  } catch {
    file = {};
  }
  try {
    file[modelKey] = { at: Date.now() };
    store.setItem(DOWNLOAD_RECORD_KEY, JSON.stringify(file));
  } catch {
    // Quota/private-mode: tracking is best-effort only.
  }
}
