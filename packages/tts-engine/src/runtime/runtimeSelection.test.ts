import { describe, expect, it } from "vitest";
import { describeActiveRuntime, selectLocalRuntimePlan } from "./runtimeSelection.js";
import type { DeviceProfile } from "../device/deviceProfile.js";

function profile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    webgpu: { supported: false, adapterAvailable: false, adapterInfo: { confidence: "unknown", value: null } },
    webAssembly: { supported: true },
    cpuThreads: { confidence: "known", value: 8 },
    deviceMemoryGB: { confidence: "unknown", value: null },
    crossOriginIsolated: { confidence: "known", value: true },
    sharedArrayBuffer: { confidence: "known", value: true },
    storage: { confidence: "unknown", value: null },
    browserKind: { confidence: "known", value: "chromium" as const },
    detectedAt: 0,
    ...overrides,
  };
}

describe("selectLocalRuntimePlan", () => {
  it("tries WebGPU first only when a real adapter probe passed", () => {
    const plan = selectLocalRuntimePlan(
      profile({ webgpu: { supported: true, adapterAvailable: true, adapterInfo: { confidence: "unknown", value: null } } }),
    );
    expect(plan.candidates).toEqual(["webgpu", "wasm"]);
    expect(plan.primary).toBe("webgpu");
    expect(plan.localGenerationAvailable).toBe(true);
    expect(plan.webgpuState).toBe("available");
    expect(plan.userExplanation).toMatch(/GPU/i);
  });

  it("skips straight to WASM when the adapter probe fails", () => {
    const plan = selectLocalRuntimePlan(
      profile({ webgpu: { supported: true, adapterAvailable: false, adapterInfo: { confidence: "unknown", value: null } } }),
    );
    expect(plan.candidates).toEqual(["wasm"]);
    expect(plan.primary).toBe("wasm");
    expect(plan.webgpuState).toBe("adapter-missing");
    expect(plan.userExplanation).toMatch(/CPU mode/i);
  });

  it("drops WebGPU after a recorded load failure for the rest of the session", () => {
    const plan = selectLocalRuntimePlan(
      profile({ webgpu: { supported: true, adapterAvailable: true, adapterInfo: { confidence: "unknown", value: null } } }),
      { webgpuFailed: true },
    );
    expect(plan.candidates).toEqual(["wasm"]);
    expect(plan.webgpuState).toBe("failed");
  });

  it("reports local generation unavailable without WebAssembly", () => {
    const plan = selectLocalRuntimePlan(profile({ webAssembly: { supported: false } }));
    expect(plan.localGenerationAvailable).toBe(false);
    expect(plan.candidates).toEqual([]);
    expect(plan.primary).toBeNull();
    expect(plan.userExplanation).toBeNull();
  });

  it("handles browsers with no WebGPU exposure at all", () => {
    const plan = selectLocalRuntimePlan(profile());
    expect(plan.webgpuState).toBe("unavailable");
    expect(plan.candidates).toEqual(["wasm"]);
  });
});

describe("describeActiveRuntime", () => {
  it("uses plain language for both runtimes", () => {
    expect(describeActiveRuntime("webgpu")).toBe("Using your GPU for local generation");
    expect(describeActiveRuntime("wasm")).toBe("Using CPU mode for local generation");
  });
});
