import { expect, test } from "@playwright/test";

test("app skeleton loads with cross-origin isolation headers (D-010)", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response, "page responded").not.toBeNull();
  expect(response!.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(response!.headers()["cross-origin-embedder-policy"]).toBe(
    "require-corp",
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Text-to-Speech",
  );
});
