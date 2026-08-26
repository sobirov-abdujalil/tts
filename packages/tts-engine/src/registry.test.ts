import { describe, expect, it } from "vitest";
import { getPreferredLocalProvider, getProvider, listProviderIds } from "./registry.js";
import { KokoroLocalProvider } from "./providers/kokoro/kokoroProvider.js";
import { BASIC_VOICES, MAX_INPUT_CHARS, SPEED_RANGE } from "@tts/shared";

describe("provider registry", () => {
  it("registers the built-in Kokoro local provider", () => {
    expect(listProviderIds()).toContain(KokoroLocalProvider.ID);
  });

  it("instantiates providers by id", () => {
    const provider = getProvider(KokoroLocalProvider.ID);
    expect(provider.id).toBe(KokoroLocalProvider.ID);
    expect(provider.kind).toBe("local");
  });

  it("throws for unknown provider ids", () => {
    expect(() => getProvider("does-not-exist")).toThrow(/no tts provider/i);
  });

  it("exposes the preferred local provider without hard-coding ids at call sites", () => {
    const provider = getPreferredLocalProvider();
    expect(provider.kind).toBe("local");
    expect(provider.isAvailable?.({ webAssembly: true, webgpu: false })).toBe(true);
    expect(provider.isAvailable?.({ webAssembly: false, webgpu: false })).toBe(false);
  });

  it("advertises capabilities sourced from the shared registry", () => {
    const provider = getProvider(KokoroLocalProvider.ID);
    expect(provider.capabilities.voices.map((v) => v.id)).toEqual(
      BASIC_VOICES.map((v) => v.id),
    );
    expect(provider.capabilities.maxCharsPerRequest).toBe(MAX_INPUT_CHARS);
    expect(provider.capabilities.speedRange).toEqual(SPEED_RANGE);
    expect(provider.capabilities.supportsEmotion).toBe(false);
  });
});
