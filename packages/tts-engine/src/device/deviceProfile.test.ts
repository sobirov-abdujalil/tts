import { describe, expect, it } from "vitest";
import {
  describeDeviceSignature,
  detectDeviceProfile,
  toDeviceReport,
  type DeviceProfile,
  type DeviceProfileDeps,
  type NavigatorLike,
} from "./deviceProfile.js";

function navigatorWith(overrides: Partial<NavigatorLike>): NavigatorLike {
  return { ...overrides };
}

function deps(partial: Partial<DeviceProfileDeps>): DeviceProfileDeps {
  return { now: () => 1_000, ...partial };
}

const GPU_OK: NavigatorLike["gpu"] = {
  requestAdapter: async () => ({ info: { vendor: "test-vendor", architecture: "test-arch" } }),
};

describe("detectDeviceProfile", () => {
  it("classifies fully capable desktop-chromium-like devices", async () => {
    const profile = await detectDeviceProfile(
      deps({
        navigator: navigatorWith({
          gpu: GPU_OK,
          hardwareConcurrency: 8,
          deviceMemory: 8,
          userAgentData: { brands: [{ brand: "Chromium", version: "130" }] },
          storage: {
            estimate: async () => ({ quota: 120 * 1024 * 1024 * 1024, usage: 90 * 1024 * 1024 }),
          },
        }),
        crossOriginIsolated: true,
      }),
    );

    expect(profile.webgpu).toEqual({
      supported: true,
      adapterAvailable: true,
      adapterInfo: { confidence: "known", value: { vendor: "test-vendor", architecture: "test-arch" } },
    });
    expect(profile.webAssembly.supported).toBe(true);
    expect(profile.cpuThreads).toEqual({ confidence: "known", value: 8 });
    // deviceMemory is a browser-reported approximation — never "known".
    expect(profile.deviceMemoryGB).toEqual({ confidence: "estimated", value: 8 });
    expect(profile.crossOriginIsolated).toEqual({ confidence: "known", value: true });
    expect(profile.sharedArrayBuffer.value).toBe(true);
    expect(profile.storage.confidence).toBe("estimated");
    expect(profile.browserKind).toEqual({ confidence: "known", value: "chromium" });
  });

  it("treats a missing WebGPU API as unsupported, not unknown", async () => {
    const profile = await detectDeviceProfile(deps({ navigator: navigatorWith({}) }));
    expect(profile.webgpu.supported).toBe(false);
    expect(profile.webgpu.adapterAvailable).toBe(false);
  });

  it("distinguishes gpu presence from a working adapter (headless case)", async () => {
    const profile = await detectDeviceProfile(
      deps({ navigator: navigatorWith({ gpu: { requestAdapter: async () => null } }) }),
    );
    expect(profile.webgpu.supported).toBe(true);
    expect(profile.webgpu.adapterAvailable).toBe(false);
    expect(profile.webgpu.adapterInfo.confidence).toBe("unknown");
  });

  it("never crashes when the adapter probe throws", async () => {
    const profile = await detectDeviceProfile(
      deps({
        navigator: navigatorWith({
          gpu: {
            requestAdapter: async () => {
              throw new Error("driver exploded");
            },
          },
        }),
      }),
    );
    expect(profile.webgpu.supported).toBe(true);
    expect(profile.webgpu.adapterAvailable).toBe(false);
  });

  it("marks signals unknown when the platform does not expose them", async () => {
    const profile = await detectDeviceProfile(deps({ navigator: navigatorWith({}) }));
    expect(profile.cpuThreads).toEqual({ confidence: "unknown", value: null });
    expect(profile.deviceMemoryGB).toEqual({ confidence: "unknown", value: null });
    expect(profile.crossOriginIsolated).toEqual({ confidence: "unknown", value: null });
    expect(profile.browserKind).toEqual({ confidence: "unknown", value: null });
    expect(profile.storage).toEqual({ confidence: "unknown", value: null });
  });

  it("rejects nonsense numeric values instead of trusting them", async () => {
    const profile = await detectDeviceProfile(
      deps({ navigator: navigatorWith({ hardwareConcurrency: -3, deviceMemory: Number.NaN }) }),
    );
    expect(profile.cpuThreads.confidence).toBe("unknown");
    expect(profile.deviceMemoryGB.confidence).toBe("unknown");
  });

  it("survives a throwing storage estimate", async () => {
    const profile = await detectDeviceProfile(
      deps({
        navigator: navigatorWith({
          storage: {
            estimate: async () => {
              throw new Error("nope");
            },
          },
        }),
      }),
    );
    expect(profile.storage.confidence).toBe("unknown");
  });

  it("identifies firefox and safari coarsely without deep UA parsing", async () => {
    const firefox = await detectDeviceProfile(
      deps({ navigator: navigatorWith({ userAgent: "Mozilla/5.0 Firefox/133.0" }) }),
    );
    const safari = await detectDeviceProfile(
      deps({
        navigator: navigatorWith({
          userAgent: "Mozilla/5.0 (Macintosh) Version/17.4 Safari/605.1.15",
        }),
      }),
    );
    expect(firefox.browserKind.value).toBe("firefox");
    expect(safari.browserKind.value).toBe("safari");
  });
});

describe("describeDeviceSignature", () => {
  it("changes when benchmark-relevant inputs change", async () => {
    const base = await detectDeviceProfile(
      deps({ navigator: navigatorWith({ hardwareConcurrency: 8 }), crossOriginIsolated: true }),
    );
    const fewerThreads = await detectDeviceProfile(
      deps({ navigator: navigatorWith({ hardwareConcurrency: 4 }), crossOriginIsolated: true }),
    );

    expect(describeDeviceSignature(base)).not.toBe(describeDeviceSignature(fewerThreads));

    const notIsolated = await detectDeviceProfile(
      deps({ navigator: navigatorWith({ hardwareConcurrency: 8 }), crossOriginIsolated: false }),
    );
    expect(describeDeviceSignature(base)).not.toBe(describeDeviceSignature(notIsolated));
  });

  it("is stable for identical inputs", async () => {
    const make = (): Promise<DeviceProfile> =>
      detectDeviceProfile(
        deps({ navigator: navigatorWith({ hardwareConcurrency: 8 }), crossOriginIsolated: true }),
      );
    expect(describeDeviceSignature(await make())).toBe(describeDeviceSignature(await make()));
  });
});

describe("toDeviceReport", () => {
  it("maps the profile onto the provider estimate context shape", async () => {
    const profile = await detectDeviceProfile(
      deps({
        navigator: navigatorWith({
          hardwareConcurrency: 4,
          deviceMemory: 4,
          storage: { estimate: async () => ({ quota: 1000, usage: 10 }) },
        }),
        crossOriginIsolated: false,
      }),
    );
    expect(toDeviceReport(profile)).toEqual({
      webgpuAvailable: false,
      cpuCores: 4,
      deviceMemoryGB: 4,
      crossOriginIsolated: false,
      storageQuotaBytes: 1000,
    });
  });
});
