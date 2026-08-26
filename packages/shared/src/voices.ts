/**
 * Curated subset of Kokoro-82M pretrained voices exposed on the free/basic
 * tier (PRODUCT_SPEC.md §6.2). Data-driven catalog shared by the frontend,
 * engine, and future cloud providers — the single source of truth for voice
 * metadata. Full catalog/search/previews arrive in M4.
 */

export interface VoiceOption {
  /** Stable id passed to the synthesis backend, e.g. "af_heart". */
  id: string;
  /** Human-readable name shown in the UI. */
  name: string;
  /** BCP-47-ish language tag. */
  language: string;
  gender: "male" | "female";
}

export const BASIC_VOICES: readonly VoiceOption[] = [
  { id: "af_heart", name: "Heart", language: "en-US", gender: "female" },
  { id: "af_bella", name: "Bella", language: "en-US", gender: "female" },
  { id: "af_nova", name: "Nova", language: "en-US", gender: "female" },
  { id: "am_adam", name: "Adam", language: "en-US", gender: "male" },
  { id: "am_michael", name: "Michael", language: "en-US", gender: "male" },
  { id: "bf_emma", name: "Emma", language: "en-GB", gender: "female" },
  { id: "bm_george", name: "George", language: "en-GB", gender: "male" },
];

export const DEFAULT_VOICE_ID = "af_heart";

/** Look up a voice descriptor by id; undefined for unknown ids. */
export function findVoice(voiceId: string): VoiceOption | undefined {
  return BASIC_VOICES.find((voice) => voice.id === voiceId);
}
