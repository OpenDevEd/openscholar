import { test, expect, type Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";

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

    await page.goto(
      "/evidence-libraries/kh74ezgjwdv2nkbq2nafdg14z98d7t3b/admin?return=%2Fadmin%2Fitems",
    );

    await expect(page).toHaveURL(/\/sign-in/);
    const redirectUrl = decodeURIComponent(
      new URL(page.url()).searchParams.get("redirect_url") ?? "",
    );
    expect(redirectUrl).toContain(
      "/evidence-libraries/kh74ezgjwdv2nkbq2nafdg14z98d7t3b/admin",
    );
    expect(redirectUrl).toContain("return=/admin/items");
  });

  test("explains a refusal on OpenScholar instead of redirecting", async ({
    page,
  }) => {
    await signIn(page);

    // A library nobody owns: the page says so and stays on OpenScholar.
    await page.goto("/evidence-libraries/not-a-library/admin");
    await expect(page.locator("[data-admin-handoff='no_access']")).toBeVisible();
    await expect(page).toHaveURL(/\/evidence-libraries\/not-a-library\/admin$/);
    await expect(
      page.getByRole("link", { name: "Back to libraries" }),
    ).toBeVisible();
  });

  test("stops instead of looping when the library reports a failed link", async ({
    page,
  }) => {
    await signIn(page);

    await page.goto(
      "/evidence-libraries/kh74ezgjwdv2nkbq2nafdg14z98d7t3b/admin?error=invalid_code&return=%2Fadmin",
    );

    await expect(
      page.locator("[data-admin-handoff='expired_link']"),
    ).toBeVisible();
    const retry = page.getByRole("link", { name: "Try again" });
    await expect(retry).toHaveAttribute(
      "href",
      "/evidence-libraries/kh74ezgjwdv2nkbq2nafdg14z98d7t3b/admin?return=%2Fadmin",
    );
  });
});
