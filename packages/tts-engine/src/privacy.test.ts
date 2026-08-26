/**
 * Source-level privacy guard (SECURITY.md §6): the entire local-inference
 * surface must be free of network egress primitives. Model-file downloads
 * happen inside kokoro-js itself (node_modules — not scanned here); our own
 * code may never fetch anything. E2E tests additionally assert at runtime
 * that no request carries user text.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "fetch()", pattern: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { name: "axios", pattern: /\baxios\b/ },
  { name: "WebSocket", pattern: /\bWebSocket\b/ },
  { name: "sendBeacon", pattern: /sendBeacon/ },
  { name: "API path literal", pattern: /["'`]\/api\// },
];

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      return [path];
    }
    return [];
  });
}

describe("local-mode privacy invariant (source level)", () => {
  it("engine sources contain no network egress primitives", () => {
    const violations: string[] = [];
    for (const file of listTypeScriptFiles(SRC_DIR)) {
      const contents = readFileSync(file, "utf8");
      for (const { name, pattern } of FORBIDDEN_PATTERNS) {
        if (pattern.test(contents)) violations.push(`${file}: ${name}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
