import { describe, expect, it } from "vitest";
import { MAX_INPUT_CHARS } from "./limits.js";
import { validateSynthesisText } from "./validation.js";

function codeOf(text: string, maxChars?: number): string | undefined {
  const result = validateSynthesisText(text, maxChars);
  return result.valid ? undefined : result.code;
}

describe("validateSynthesisText", () => {
  it("accepts ordinary text", () => {
    expect(validateSynthesisText("Hello world.")).toEqual({ valid: true });
  });

  it("rejects empty and whitespace-only input", () => {
    expect(codeOf("")).toBe("empty");
    expect(codeOf("   \n\t ")).toBe("empty");
  });

  it("rejects text beyond the character limit", () => {
    const long = "a".repeat(MAX_INPUT_CHARS + 1);
    const result = validateSynthesisText(long);
    expect(result.valid).toBe(false);
    if (!result.valid && result.code === "too-long") {
      expect(result.maxChars).toBe(MAX_INPUT_CHARS);
      expect(result.message).toContain("limit");
    } else {
      throw new Error("expected too-long failure");
    }
  });

  it("accepts text at exactly the limit", () => {
    expect(validateSynthesisText("a".repeat(MAX_INPUT_CHARS)).valid).toBe(true);
  });

  it("supports an explicit custom limit", () => {
    expect(codeOf("abcde", 4)).toBe("too-long");
    expect(validateSynthesisText("abcd", 4).valid).toBe(true);
  });
});
