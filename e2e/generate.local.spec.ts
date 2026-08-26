import { expect, test } from "@playwright/test";

/**
 * Full local generation happy path (ROADMAP.md M2 acceptance):
 *  1. type text → generate → model downloads with progress → audio plays
 *  2. download produces a .wav file
 *  3. NO network request carries the user's text (privacy invariant)
 *  4. second visit (reload) does not re-download the model (Cache API)
 *
 * Gated behind E2E_LOCAL_MODEL=1 because it downloads ~86 MB of real weights
 * and runs actual inference; CI runs the fast suite by default.
 *
 *   E2E_LOCAL_MODEL=1 pnpm test:e2e
 */

const SENTENCE = "The quick brown fox jumps over the lazy dog.";
/** Marker that must never appear in any request URL or payload. */
const SENTINEL = "QUANTUM-ZEBRA-PRIVACY-MARKER";
const GENERATION_TIMEOUT = 8 * 60 * 1000;

test.skip(
  process.env.E2E_LOCAL_MODEL !== "1",
  "real-model e2e — run with E2E_LOCAL_MODEL=1",
);

test.use({
  launchOptions: {
    args: ["--autoplay-policy=no-user-gesture-required"],
  },
});

const MODEL_HOST_PATTERN = /(huggingface\.co|hf\.co|xethub|cdn-lfs)/i;

function isModelRequest(url: string): boolean {
  return MODEL_HOST_PATTERN.test(url);
}

function assertTextNeverLeftDevice(
  requests: Array<{ url: string; body: string | null }>,
): void {
  const secrets = [SENTENCE, SENTINEL];
  for (const secret of secrets) {
    for (const request of requests) {
      expect(
        request.url,
        `request URL must not contain user text: ${request.url}`,
      ).not.toContain(secret);
      expect(
        request.body ?? "",
        "request payload must not contain user text",
      ).not.toContain(secret);
    }
  }
}

test("generates speech locally, plays it, downloads WAV, and never sends the text", async ({
  page,
}) => {
  test.setTimeout(GENERATION_TIMEOUT + 120_000);

  const requests: Array<{ url: string; body: string | null }> = [];
  page.on("request", (request) => {
    requests.push({ url: request.url(), body: request.postData() });
  });

  await page.goto("/");
  const editor = page.getByTestId("editor");
  await editor.fill(`${SENTENCE} ${SENTINEL}`);

  await page.getByTestId("generate-btn").click();

  // Model download progress appears on first use (may be instant when cached).
  const progressOrPlayer = page
    .getByTestId("model-progress")
    .or(page.getByTestId("result-panel"));
  await expect(progressOrPlayer.first()).toBeVisible();

  // Wait for generation to finish and the inline player to appear.
  await expect(page.getByTestId("player")).toBeVisible({ timeout: GENERATION_TIMEOUT });

  // Audio is real and decodable: metadata loaded with positive duration.
  // Kick metadata loading once (harmless when already loading); polling must
  // NOT call load() itself — that resets readyState/duration every iteration.
  await page.getByTestId("player").evaluate((element: HTMLAudioElement) => {
    if (element.readyState === 0) element.load();
  });
  await expect
    .poll(() =>
      page.getByTestId("player").evaluate((element: HTMLAudioElement) => {
        return (
          element.readyState >= 1 &&
          Number.isFinite(element.duration) &&
          element.duration > 0
        );
      }),
    )
    .toBe(true);
  await page.getByTestId("player").evaluate((element: HTMLAudioElement) => element.play());
  const paused = await page.getByTestId("player").evaluate((element) => element.paused);
  expect(paused).toBe(false);

  // Download WAV.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-btn").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/speech-af_heart-.*\.wav$/);
  expect(await download.path()).toBeTruthy();

  // Privacy invariant: nothing ever carried the text off-device.
  assertTextNeverLeftDevice(requests);
});

test("second visit reuses the cached model instead of re-downloading", async ({ page }) => {
  test.setTimeout(2 * GENERATION_TIMEOUT);

  const firstVisitModelRequests = new Set<string>();
  page.on("request", (request) => {
    if (isModelRequest(request.url())) firstVisitModelRequests.add(request.url());
  });

  await page.goto("/");
  const editor = page.getByTestId("editor");
  await editor.fill(`${SENTENCE} One.`);
  await page.getByTestId("generate-btn").click();
  await expect(page.getByTestId("player")).toBeVisible({ timeout: GENERATION_TIMEOUT });

  // Reload → fresh JS context, warm Cache API.
  await page.reload();
  await expect(page.getByTestId("editor")).toBeVisible();

  let reloadModelRequestCount = 0;
  page.on("request", (request) => {
    if (isModelRequest(request.url())) reloadModelRequestCount += 1;
  });

  await page.getByTestId("editor").fill(`${SENTENCE} Two.`);
  await page.getByTestId("generate-btn").click();
  await expect(page.getByTestId("player")).toBeVisible({ timeout: GENERATION_TIMEOUT });

  // The first visit must have downloaded something (sanity), while the warm
  // second visit must not fetch model/voice bytes again.
  expect(firstVisitModelRequests.size).toBeGreaterThan(0);
  expect(reloadModelRequestCount).toBe(0);
});
