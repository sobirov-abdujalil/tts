/**
 * Provider registry — the only place provider ids are bound to
 * implementations. The router/UI resolves providers through this module and
 * never imports a concrete provider by name (packages/tts-engine contract).
 *
 * Built-in local providers register themselves at module load; importing the
 * engine package is sufficient to make them resolvable.
 */

import type { TTSModelProvider } from "./index.js";
import { KokoroLocalProvider } from "./providers/kokoro/kokoroProvider.js";
import {
  getDefaultBenchmarkCache,
  localStorageStore,
  readStoredDeviceSignature,
} from "./benchmark/benchmarkCache.js";
import { readDownloadRecord, writeDownloadRecord } from "./cache/downloadTracker.js";
import { KOKORO_DEFAULT_LOAD_CONFIG } from "./providers/kokoro/config.js";

type ProviderFactory = () => TTSModelProvider;

const providers = new Map<string, ProviderFactory>();

export function registerProvider(id: string, factory: ProviderFactory): void {
  if (providers.has(id)) {
    throw new Error(`A TTS provider with id "${id}" is already registered.`);
  }
  providers.set(id, factory);
}

export function listProviderIds(): string[] {
  return [...providers.keys()];
}

/** Instantiate a registered provider; throws for unknown ids. */
export function getProvider(id: string): TTSModelProvider {
  const factory = providers.get(id);
  if (!factory) {
    throw new Error(`No TTS provider registered with id "${id}".`);
  }
  return factory();
}

/**
 * The local provider to use on this device, honoring registration order.
 * Availability filtering (WebAssembly/WebGPU probes) happens in M3 capability
 * detection; today every modern browser runs the WASM path.
 */
export function getPreferredLocalProvider(): TTSModelProvider {
  const first = providers.entries().next();
  if (first.done) {
    throw new Error("No TTS providers are registered.");
  }
  return first.value[1]();
}

registerProvider(KokoroLocalProvider.ID, () => {
  const store = localStorageStore();
  const benchmarkCache = getDefaultBenchmarkCache();
  let instance: KokoroLocalProvider | null = null;
  instance = new KokoroLocalProvider({
    // Honest estimates from the local-only benchmark cache (null until a
    // measurement exists for this device signature).
    estimateLookup: () => {
      const signature = readStoredDeviceSignature(store);
      if (!signature) return null;
      const entry = benchmarkCache.getForModel({
        modelId: KOKORO_DEFAULT_LOAD_CONFIG.modelId,
        dtype: KOKORO_DEFAULT_LOAD_CONFIG.dtype,
        deviceSignature: signature,
      });
      return entry
        ? {
            realtimeFactor: entry.rtf,
            runtime: entry.runtime,
            modelId: entry.modelId,
            dtype: entry.dtype,
          }
        : null;
    },
    // Corrupted-cache recovery is enabled wherever localStorage exists.
    ...(store
      ? {
          recovery: {
            getLastSuccessfulLoad: (modelKey: string) => readDownloadRecord(store, modelKey),
            recordSuccessfulLoad: (modelKey: string) => writeDownloadRecord(store, modelKey),
            clearCachedFiles: async () => {
              await instance?.clearModelCache();
            },
          },
        }
      : {}),
  });
  return instance;
});
