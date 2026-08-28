import { test, expect, type Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";

const LIBRARY_ID = "kh74ezgjwdv2nkbq2nafdg14z98d7t3b";
const ADMIN_PATH = `/evidence-libraries/${LIBRARY_ID}/admin`;

function getTestUserEmail() {
  const emailAddress = process.env.E2E_CLERK_USER_EMAIL;
  if (!emailAddress) {
    throw new Error("Missing E2E_CLERK_USER_EMAIL for the admin handoff test.");
  }
  return emailAddress;
}

async function signIn(page: Page) {
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress: getTestUserEmail() });
}

test.describe("evidence library admin handoff", () => {
  test("sends a signed-out visitor to sign in and keeps where they were going", async ({
    page,
  }) => {
    // Clerk's development instance hands out its browser token on the first
    // page, so open the home page before the protected one.
    await page.goto("/");
    await clerk.loaded({ page });

    await page.goto(`${ADMIN_PATH}?return=%2Fadmin%2Fitems`);

    await expect(page).toHaveURL(/\/sign-in/);
    const redirectUrl = new URL(
      new URL(page.url()).searchParams.get("redirect_url") ?? "",
      "http://localhost",
    );
    expect(redirectUrl.pathname).toBe(ADMIN_PATH);
    expect(redirectUrl.searchParams.get("return")).toBe("/admin/items");
  });

  test("answers the admin address with a redirect, not a page", async ({
    page,
  }) => {
    await signIn(page);

    // A library nobody owns: a real 303 to the page that explains it.
    const refusal = await page.request.get(
      "/evidence-libraries/not-a-library/admin?return=%2Fadmin%2Fitems",
      { maxRedirects: 0 },
    );
    expect(refusal.status()).toBe(303);
    expect(refusal.headers()["location"]).toBe(
      "/evidence-libraries/not-a-library/admin/status?return=%2Fadmin%2Fitems",
    );

    // Only a real GET may spend a code. Next answers HEAD through GET, and
    // OPTIONS by itself, unless both are exported, so every method is
    // checked over real HTTP.
    for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const answer = await page.request.fetch(`${ADMIN_PATH}?return=%2Fadmin`, {
        method,
        maxRedirects: 0,
      });
      expect(answer.status(), `${method} must not spend a code`).toBe(405);
      expect(answer.headers()["allow"]).toBe("GET");
      expect(answer.headers()["cache-control"]).toBe("no-store");
    }

    // The library reported a failed code: no new code is asked for.
    const failed = await page.request.get(
      `${ADMIN_PATH}?error=invalid_code&return=%2Fadmin`,
      { maxRedirects: 0 },
    );
    expect(failed.status()).toBe(303);
    expect(failed.headers()["location"]).toBe(
      `${ADMIN_PATH}/status?state=expired_link&return=%2Fadmin`,
    );
  });

  test("explains a refusal on OpenScholar instead of redirecting", async ({
    page,
  }) => {
    await signIn(page);

    await page.goto("/evidence-libraries/not-a-library/admin");
    await expect(page.locator("[data-admin-handoff='no_access']")).toBeVisible();
    await expect(page).toHaveURL(
      /\/evidence-libraries\/not-a-library\/admin\/status$/,
    );
    await expect(
      page.getByRole("link", { name: "Back to libraries" }),
    ).toBeVisible();
  });

  test("stops instead of looping when the library reports a failed link", async ({
    page,
  }) => {
    await signIn(page);

    await page.goto(`${ADMIN_PATH}?error=invalid_code&return=%2Fadmin`);

    await expect(
      page.locator("[data-admin-handoff='expired_link']"),
    ).toBeVisible();
    const retry = page.getByRole("link", { name: "Try again" });
    await expect(retry).toHaveAttribute(
      "href",
      `${ADMIN_PATH}?return=%2Fadmin`,
    );
  });
});
