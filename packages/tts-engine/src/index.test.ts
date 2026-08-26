import { describe, expect, it } from "vitest";
import type { AudioResult, LoadedModel, TTSModelProvider } from "./index";

/**
 * Scaffold-sanity type-contract test: proves the public provider contract
 * compiles standalone (no React/DOM deps) and behaves as an interface should.
 * Replaced by real engine tests when the first provider lands (M2).
 */
describe("TTSModelProvider contract", () => {
  it("accepts a minimal conforming implementation", async () => {
    const fixture: TTSModelProvider = {
      id: "fixture-provider",
      kind: "local",
      capabilities: {
        voices: [{ id: "v1", name: "Fixture Voice", language: "en-US" }],
        speedRange: { min: 0.5, max: 2 },
        supportsEmotion: false,
        maxCharsPerRequest: 1000,
      },
      estimate: () => null,
      load: () =>
        Promise.resolve({
          generate: (): Promise<AudioResult> =>
            Promise.reject(new Error("no provider implemented yet (planned: M2)")),
          release: () => Promise.resolve(),
        } satisfies LoadedModel),
    };

    expect(fixture.id).toBe("fixture-provider");
    const model = await fixture.load({ onProgress: () => {} });
    await expect(model.generate({ text: "anything", voiceId: "v1" })).rejects.toThrow(
      /no provider implemented yet/,
    );
    await model.release();
  });

  it("reports null estimates when it cannot estimate", () => {
    const fixture: Pick<TTSModelProvider, "estimate"> = { estimate: () => null };
    expect(
      fixture.estimate({
        charCount: 10,
        device: {
          webgpuAvailable: false,
          cpuCores: 4,
          crossOriginIsolated: false,
        },
      }),
    ).toBeNull();
  });
});
