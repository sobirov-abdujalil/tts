import { expect, test } from "@playwright/test";

/**
 * Fast always-on device analysis checks (ROADMAP.md M3):
 *  1. capability detection renders a plain-language recommendation
 *  2. NO model bytes are downloaded before the user asks to generate
 *  3. runtime selection reacts to a mocked WebGPU-capable device
 *
 * Real-hardware variants live in generate.local.spec.ts /
 * benchmark.local.spec.ts behind E2E_LOCAL_MODEL=1.
 */

const MODEL_HOST_PATTERN = /(huggingface\.co|hf\.co|xethub|cdn-lfs)/i;

test.describe("device analysis card", () => {
  test("recommends local generation without downloading any model bytes", async ({ page }) => {
    const modelRequests: string[] = [];
    page.on("request", (request) => {
      if (MODEL_HOST_PATTERN.test(request.url())) modelRequests.push(request.url());
    });

    await page.goto("/");

    const card = page.getByTestId("device-card");
    await expect(card).toBeVisible();

    // Recommendation appears in plain language once detection settles.
    const recommendation = page.getByTestId("recommendation");
    await expect(recommendation).toContainText("Recommended:");
    await expect(recommendation).toContainText("Kokoro");

    // Privacy framing is explicit on the card itself.
    await expect(page.getByTestId("privacy-line")).toContainText("on your device");

    // No measurement is claimed before a real benchmark ran.
    await expect(page.getByTestId("measured-speed")).toHaveCount(0);

    // Interacting must still not fetch model bytes.
    await page.getByTestId("editor").fill("Hello world");

    expect(modelRequests, "model bytes must never load before Generate").toEqual([]);
  });

  test("a mocked WebGPU-capable device gets GPU-first messaging", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Mock hardware API: present + working adapter (CI has no real GPU).
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "gpu", {
        configurable: true,
        get: () => ({
          requestAdapter: async () => ({
            info: { vendor: "test-vendor", architecture: "test-arch" },
          }),
        }),
      });
    });

    await page.goto("/");
    const card = page.getByTestId("device-card");
    await expect(card).toBeVisible();
    const modeNote = page.locator('[data-testid="device-card"]');
    await expect(modeNote).toContainText(/GPU/i);

    await context.close();
  });
});
