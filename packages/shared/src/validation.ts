/**
 * Text validation shared by the workspace UI (live counter/disable state) and
 * the engine (defensive check before dispatching to the worker). Pure logic,
 * no dependencies.
 */

import { MAX_INPUT_CHARS } from "./limits.js";

export type TextValidationFailure =
  | { valid: false; code: "empty"; message: string }
  | { valid: false; code: "too-long"; message: string; maxChars: number }
  | { valid: true };

export function validateSynthesisText(
  text: string,
  maxChars: number = MAX_INPUT_CHARS,
): TextValidationFailure {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { valid: false, code: "empty", message: "Enter some text to generate speech." };
  }
  if (trimmed.length > maxChars) {
    return {
      valid: false,
      code: "too-long",
      maxChars,
      message: `Text is too long (${trimmed.length.toLocaleString()} characters). The current limit is ${maxChars.toLocaleString()}.`,
    };
  }
  return { valid: true };
}
