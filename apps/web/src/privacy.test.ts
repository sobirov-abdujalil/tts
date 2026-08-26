/**
 * Source-level privacy guard for the web app (SECURITY.md §6, D-011 spirit):
 * the workspace UI must not perform network I/O. All server communication
 * arrives later (M5/M7) through dedicated, reviewed API-client modules — at
 * which point this guard gains an explicit allowlist.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "fetch()", pattern: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { name: "axios", pattern: /\baxios\b/ },
  { name: "WebSocket", pattern: /\bWebSocket\b/ },
  { name: "sendBeacon", pattern: /sendBeacon/ },
];

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      return [path];
    }
    return [];
  });
}

describe("local-mode privacy invariant (web sources)", () => {
  it("workspace UI contains no network egress primitives", () => {
    const violations: string[] = [];
    for (const file of listFiles(SRC_DIR)) {
      const contents = readFileSync(file, "utf8");
      for (const { name, pattern } of FORBIDDEN_PATTERNS) {
        if (pattern.test(contents)) violations.push(`${file}: ${name}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
