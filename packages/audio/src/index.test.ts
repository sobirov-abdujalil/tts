import { describe, expect, it } from "vitest";
import { TARGET_SAMPLE_RATE_HZ } from "./index";

// Scaffold-sanity test proving test tooling is wired for this package.
// Real encoder/chunker/concatenator tests arrive with M2.
describe("audio scaffold", () => {
  it("exposes the canonical timeline sample rate", () => {
    expect(TARGET_SAMPLE_RATE_HZ).toBe(24_000);
  });
});
