import { describe, expect, it } from "vitest";
import {
  estimateGenerationSeconds,
  formatDuration,
  formatSpeedMultiplier,
  isValidRtf,
} from "./estimation.js";

describe("estimateGenerationSeconds", () => {
  it("computes target_duration × rtf (the documented policy)", () => {
    // Spec example: RTF 0.5 → 10 s of audio takes 5 s.
    expect(estimateGenerationSeconds(10, 0.5)).toBeCloseTo(5, 6);
    // The canonical UI example: 7 minutes of audio at ~0.5556 RTF ≈ 3m 53s.
    expect(estimateGenerationSeconds(420, 0.55555)).toBeCloseTo(233.33, 1);
  });

  it("rejects unusable inputs instead of producing nonsense", () => {
    expect(estimateGenerationSeconds(0, 0.5)).toBeNull();
    expect(estimateGenerationSeconds(-1, 0.5)).toBeNull();
    expect(estimateGenerationSeconds(420, Number.NaN)).toBeNull();
    expect(estimateGenerationSeconds(420, 0)).toBeNull();
    expect(estimateGenerationSeconds(Number.NaN, 0.5)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes+seconds, and hours+minutes", () => {
    expect(formatDuration(52)).toBe("52s");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(233)).toBe("3m 53s"); // the 7-minute example
    expect(formatDuration(3600)).toBe("1h 00m");
    expect(formatDuration(7500)).toBe("2h 05m");
  });

  it("handles invalid input gracefully", () => {
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-4)).toBe("—");
  });
});

describe("formatSpeedMultiplier", () => {
  it("renders one decimal below 10×", () => {
    expect(formatSpeedMultiplier(1.76)).toBe("1.8× real time");
    expect(formatSpeedMultiplier(0.9)).toBe("0.9× real time");
    expect(formatSpeedMultiplier(9.94)).toBe("9.9× real time");
  });

  it("drops decimals at 10× and above", () => {
    expect(formatSpeedMultiplier(12.34)).toBe("12× real time");
  });

  it("handles invalid input gracefully", () => {
    expect(formatSpeedMultiplier(0)).toBe("—");
    expect(formatSpeedMultiplier(Number.NaN)).toBe("—");
  });
});

describe("isValidRtf", () => {
  it("accepts only positive finite numbers", () => {
    expect(isValidRtf(0.25)).toBe(true);
    expect(isValidRtf(3)).toBe(true);
    expect(isValidRtf(0)).toBe(false);
    expect(isValidRtf(-1)).toBe(false);
    expect(isValidRtf(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
