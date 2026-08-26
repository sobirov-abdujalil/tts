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

registerProvider(KokoroLocalProvider.ID, () => new KokoroLocalProvider());
