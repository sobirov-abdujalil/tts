import { describe, expect, it } from "vitest";
import {
  DOWNLOAD_RECORD_KEY,
  readDownloadRecord,
  writeDownloadRecord,
} from "./downloadTracker.js";
import type { KeyValueStore } from "../benchmark/benchmarkCache.js";

class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe("downloadTracker", () => {
  it("records and reads a successful download per model key", () => {
    const store = new MemoryStore();
    writeDownloadRecord(store, "model-a:q8");
    writeDownloadRecord(store, "model-b:fp32");

    expect(readDownloadRecord(store, "model-a:q8")).not.toBeNull();
    expect(readDownloadRecord(store, "model-b:fp32")).not.toBeNull();
    expect(readDownloadRecord(store, "model-c:q8")).toBeNull();
  });

  it("overwrites the timestamp on re-record", async () => {
    const store = new MemoryStore();
    writeDownloadRecord(store, "m");
    const first = readDownloadRecord(store, "m")!.at;
    await new Promise((resolve) => setTimeout(resolve, 5));
    writeDownloadRecord(store, "m");
    expect(readDownloadRecord(store, "m")!.at).toBeGreaterThanOrEqual(first + 5);
  });

  it("returns null for corrupted containers and heals on next write", () => {
    const store = new MemoryStore();
    store.setItem(DOWNLOAD_RECORD_KEY, "{{{bad json");
    expect(readDownloadRecord(store, "m")).toBeNull();

    writeDownloadRecord(store, "m");
    expect(readDownloadRecord(store, "m")).not.toBeNull();
  });

  it("rejects structurally invalid entries", () => {
    const store = new MemoryStore();
    store.setItem(DOWNLOAD_RECORD_KEY, JSON.stringify({ m: { at: "soon" } }));
    expect(readDownloadRecord(store, "m")).toBeNull();
  });

  it("no-ops safely without a backing store", () => {
    expect(readDownloadRecord(null, "m")).toBeNull();
    expect(() => writeDownloadRecord(null, "m")).not.toThrow();
  });
});
