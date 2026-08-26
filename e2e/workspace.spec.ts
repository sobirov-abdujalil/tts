import { expect, test } from "@playwright/test";

/**
 * Fast always-on workspace checks (no model download). The full local
 * generation happy path lives in generate.local.spec.ts, gated behind
 * E2E_LOCAL_MODEL=1 because it downloads ~86 MB of weights.
 */

test.describe("workspace shell", () => {
  test("renders editor, registry-backed voice list, and guards input", async ({ page }) => {
    const seenRequests: Array<{ url: string; body: string | null }> = [];
    page.on("request", (request) => {
      seenRequests.push({ url: request.url(), body: request.postData() });
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Text-to-Speech");

    const editor = page.getByTestId("editor");
    await expect(editor).toBeVisible();
    await expect(page.getByTestId("char-counter")).toHaveText("0 / 2,000");

    // Voice dropdown is populated from the shared registry subset.
    const options = page.getByTestId("voice-select").locator("option");
    await expect(options.first()).toContainText("Heart");
    expect(await options.count()).toBeGreaterThanOrEqual(5);

    // Generate disabled while empty; cancel hidden while idle.
    await expect(page.getByTestId("generate-btn")).toBeDisabled();
    await expect(page.getByTestId("cancel-btn")).toHaveCount(0);

    await editor.fill("Hello world");
    await expect(page.getByTestId("char-counter")).toContainText("11 / 2,000");
    await expect(page.getByTestId("generate-btn")).toBeEnabled();

    // Privacy quick-check while interacting with the page.
    for (const request of seenRequests) {
      expect(request.url).not.toContain("Hello world");
      expect(request.body ?? "").not.toContain("Hello world");
    }
  });

  test("blocks generation when text exceeds the limit", async ({ page }) => {
    await page.goto("/");
    const editor = page.getByTestId("editor");
    await editor.fill("x".repeat(2001));
    await expect(page.getByTestId("char-counter")).toContainText("too long");
    await expect(page.getByTestId("generate-btn")).toBeDisabled();

    await editor.fill("x".repeat(2000));
    await expect(page.getByTestId("char-counter")).not.toContainText("too long");
    await expect(page.getByTestId("generate-btn")).toBeEnabled();
  });
});
