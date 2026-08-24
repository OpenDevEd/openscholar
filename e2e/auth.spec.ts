import { test, expect, type Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";

function getTestUserEmail() {
  const emailAddress = process.env.E2E_CLERK_USER_EMAIL;
  if (!emailAddress) {
    throw new Error(
      "Missing E2E_CLERK_USER_EMAIL for auth E2E tests.",
    );
  }
  return emailAddress;
}

async function signIn(page: Page) {
  const emailAddress = getTestUserEmail();
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({
    page,
    emailAddress,
  });
}

test.describe("clerk auth flows", () => {
  test("anonymous user is redirected from protected route to /sign-in", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("/sign-in and /sign-up stay public when anonymous", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page).toHaveURL(/\/sign-in/);

    await page.goto("/sign-up");
    await expect(page).toHaveURL(/\/sign-up/);
  });

  test("sign in allows access to protected routes", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings/);
  });

  test("organization controls open Clerk member management", async ({
    page,
  }) => {
    await signIn(page);

    const rejectCookies = page.getByRole("button", {
      name: "Reject non-essential",
    });
    if (await rejectCookies.isVisible()) {
      await rejectCookies.click();
    }

    await page
      .getByRole("button", { name: "Open organization switcher" })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Create organization" }),
    ).toBeVisible();

    await page.getByRole("menuitem", { name: "Manage" }).click();
    const organizationDialog = page.getByRole("dialog");
    await organizationDialog
      .getByRole("button", { name: "Members", exact: true })
      .click();

    await expect(
      organizationDialog.getByRole("button", { name: "Invite" }),
    ).toBeVisible();
    await expect(
      organizationDialog.getByRole("button", {
        name: /^(Admin|Member)$/,
      }).first(),
    ).toBeVisible();

    await organizationDialog
      .getByRole("button", { name: "Open menu" })
      .first()
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Remove member" }),
    ).toBeVisible();
  });

  test("sign out returns session to anonymous behavior", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings/);
    await page.goto("/");
    await clerk.signOut({ page });

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
