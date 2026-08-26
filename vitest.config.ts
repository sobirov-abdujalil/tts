import { defineConfig } from "vitest/config";

// Single runner for all unit/integration tests across workspaces.
// apps/web is covered by Playwright e2e; component tests (jsdom) will add
// per-package Vitest configs when first needed (M4).
export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/api/src/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
    ],
    environment: "node",
  },
});
