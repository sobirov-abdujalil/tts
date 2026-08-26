import { describe, expect, it } from "vitest";
import { BASIC_VOICES, DEFAULT_VOICE_ID, findVoice } from "./voices.js";

describe("voice registry", () => {
  it("contains a non-empty curated catalog", () => {
    expect(BASIC_VOICES.length).toBeGreaterThanOrEqual(5);
  });

  it("has unique voice ids", () => {
    const ids = BASIC_VOICES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("defaults to a registered English voice", () => {
    const def = findVoice(DEFAULT_VOICE_ID);
    expect(def).toBeDefined();
    expect(def!.language.startsWith("en")).toBe(true);
  });

  it("findVoice returns undefined for unknown ids", () => {
    expect(findVoice("zz_nonexistent")).toBeUndefined();
  });
});
