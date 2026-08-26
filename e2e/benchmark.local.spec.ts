import { expect, test } from "@playwright/test";

/**
 * Real-model benchmark e2e (ROADMAP.md M3), gated like generate.local.spec.ts:
 *
 *   E2E_LOCAL_MODEL=1 pnpm test:e2e
 *
 * Covers, on real hardware:
 *  1. the short local benchmark completes after a warm generation and shows a
 *     MEASURED speed (never before)
 *  2. the measurement persists locally and is reused after reload WITHOUT
 *     re-measuring or re-downloading
 *  3. generation still works with a cached benchmark present
 */

const GENERATION_TIMEOUT = 8 * 60 * 1000;
const BENCHMARK_KEY = "tts.benchmark.results.v1";

test.skip(
  process.env.E2E_LOCAL_MODEL !== "1",
  "real-model e2e — run with E2E_LOCAL_MODEL=1",
);

test("benchmark runs once, is cached across reloads, and generation keeps working", async ({
  page,
}) => {
  test.setTimeout(3 * GENERATION_TIMEOUT);

  await page.goto("/");
  await expect(page.getByTestId("editor")).toBeVisible();

  // Before any generation there must be NO measured-speed claim.
  await expect(page.getByTestId("measured-speed")).toHaveCount(0);

  // Warm the model + run one real generation.
  await page.getByTestId("editor").fill("The quick brown fox jumps over the lazy dog.");
  await page.getByTestId("generate-btn").click();
  await expect(page.getByTestId("player")).toBeVisible({ timeout: GENERATION_TIMEOUT });

  // The quiet post-generation benchmark produces a MEASURED speed line.
  const measured = page.getByTestId("measured-speed");
  await expect(measured).toBeVisible({ timeout: 3 * 60 * 1000 });
  await expect(measured).toContainText(/Measured on this device/i);
  await expect(measured).toContainText(/real time/i);

  // The estimate is derived from the measurement.
  await expect(page.getByTestId("time-estimate")).toContainText("Estimated time for");

  // Measurement is stored locally with a positive RTF.
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), BENCHMARK_KEY);
  expect(stored).not.toBeNull();
  const parsed = JSON.parse(stored!) as {
    entries: Record<string, { rtf: number; runtime: string; modelId: string }>;
  };
  const entries = Object.values(parsed.entries);
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.every((entry) => entry.rtf > 0)).toBe(true);
  expect(entries[0]!.modelId).toContain("Kokoro");

  // Reload: fresh JS context, warm Cache API + localStorage benchmark.
  let modelRequestsAfterReload = 0;
  page.on("request", (request) => {
    if (/(huggingface\.co|hf\.co|xethub|cdn-lfs)/i.test(request.url())) modelRequestsAfterReload += 1;
  });
  await page.reload();
  await expect(page.getByTestId("recommendation")).toBeVisible();

  // Cached measurement shows immediately — no re-run needed.
  await expect(page.getByTestId("measured-speed")).toBeVisible({ timeout: 30_000 });

  // Generation after benchmark still works end-to-end.
  await page.getByTestId("editor").fill("Second generation after the speed test.");
  await page.getByTestId("generate-btn").click();
  await expect(page.getByTestId("player")).toBeVisible({ timeout: GENERATION_TIMEOUT });

  // And it ran entirely from cache.
  expect(modelRequestsAfterReload).toBe(0);
});
