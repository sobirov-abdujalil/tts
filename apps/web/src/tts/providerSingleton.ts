/**
 * App-wide TTS provider singleton.
 *
 * One provider instance per browser tab keeps the loaded worker/model warm
 * across React remounts (StrictMode double-mounts included) instead of
 * tearing down an 86 MB session twice. Memory is reclaimed by the idle
 * release timer in useLocalTts rather than by component lifecycles.
 */

import { getPreferredLocalProvider, type TTSModelProvider } from "@tts/tts-engine";

let instance: TTSModelProvider | null = null;

/** Get (or lazily create) the shared local provider instance. */
export function getAppTtsProvider(): TTSModelProvider {
  instance ??= getPreferredLocalProvider();
  return instance;
}

/** Dispose the shared instance and forget it (tests / hard resets only). */
export function disposeAppTtsProvider(): void {
  instance?.dispose?.();
  instance = null;
}
