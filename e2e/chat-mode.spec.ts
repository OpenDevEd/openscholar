import { test, expect, type Page } from "./test";
import { clerk } from "@clerk/testing/playwright";

function getTestUserEmail() {
  const emailAddress = process.env.E2E_CLERK_USER_EMAIL;
  if (!emailAddress) {
    throw new Error(
      "Missing E2E_CLERK_USER_EMAIL for chat mode E2E tests.",
    );
  }
  return emailAddress;
}

async function signIn(page: Page) {
  await clerk.loaded({ page });
  await clerk.signIn({
    page,
    emailAddress: getTestUserEmail(),
  });
}

test.describe("chat mode", () => {
  test("creates a chat job from a saved search and shows expanded papers in the sidebar", async ({
    page,
  }) => {
    const now = new Date().toISOString();

    await page.addInitScript((savedAt) => {
      window.localStorage.setItem(
        "search-history-store",
        JSON.stringify({
          state: {
            searchHistory: [
              {
                id: "e2e-saved-search",
                query: "heart disease",
                queryHistory: [
                  {
                    query: "heart disease",
                    timestamp: savedAt,
                  },
                ],
                questionHistory: [],
                screeningQuestions: [],
                screeningResponses: {},
                count: 2,
                field: "title_and_abstract",
                createdAt: savedAt,
                updatedAt: savedAt,
              },
            ],
          },
          version: 7,
        }),
      );
    }, now);

    await page.goto("/");
    await signIn(page);

    await page.goto("/extraction/new");

    await page.locator('[role="radio"][data-value="chat"]').click();
    await page.locator("#name").fill("Saved Search Chat");
    await expect(page.locator('[data-model-id]:not([data-model-id=""])')).toBeVisible();

    await page.getByRole("button", { name: /continue/i }).click();

    const savedSearchRow = page
      .locator("[data-selectable-row]")
      .filter({ hasText: "heart disease" });
    await expect(savedSearchRow).toHaveCount(1);
    await savedSearchRow.click();

    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByRole("button", { name: /start chat/i }).click();

    await expect(page).toHaveURL(/\/extraction\/[^/]+$/);
    await expect(page.locator('[data-job-mode="chat"]')).toBeVisible();
    await expect(page.locator('[data-chat-state="preparing"]')).toHaveCount(0, {
      timeout: 60_000,
    });
    await expect(page.locator('[data-sidebar-state="ready"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator("[data-paper-id]")).toHaveCount(2, {
      timeout: 60_000,
    });
  });
});
