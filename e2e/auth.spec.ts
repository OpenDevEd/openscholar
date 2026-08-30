import { test, expect, type Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";

function getTestUserEmail() {
  const emailAddress = process.env.E2E_CLERK_USER_EMAIL;
  if (!emailAddress) {
    throw new Error("Missing E2E_CLERK_USER_EMAIL for auth E2E tests.");
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
      organizationDialog
        .getByRole("button", {
          name: /^(Admin|Member)$/,
        })
        .first(),
    ).toBeVisible();

    await organizationDialog
      .getByRole("button", { name: "Open menu" })
      .first()
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Remove member" }),
    ).toBeVisible();
  });

  test("an owner can save and reopen essential library configuration", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/evidence-libraries/new");

    const libraryName = `E2E Library ${Date.now()}`;
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(libraryName);
    // Reserve waits for the server's answer about the address.
    const reserveButton = page.getByRole("button", { name: "Reserve address" });
    await expect(reserveButton).toBeEnabled({ timeout: 30_000 });
    await reserveButton.click();
    await expect(page.getByRole("status")).toHaveAttribute(
      "data-address-state",
      "reserved",
    );
    await expect(
      page.getByRole("textbox", { name: "Public address" }),
    ).toHaveText(/-lib\./);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/evidence-libraries\/[^/]+\/configuration$/);
    const configurationUrl = page.url();

    const tagline = "Evidence that survives a reload";
    await page.getByLabel("Tagline").fill(tagline);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveAttribute(
      "data-result",
      "save-success",
    );

    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog");
    await expect(preview).toContainText(libraryName);
    await expect(preview).toContainText("en-GB");
    await preview.getByRole("button", { name: "Close" }).first().click();

    await page.getByRole("button", { name: "Activate", exact: true }).click();
    await expect(page.getByRole("status")).toHaveAttribute(
      "data-result",
      "activation-success",
    );

    await page.goto("/settings");
    await page.goto(configurationUrl);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      libraryName,
    );
    await expect(page.getByLabel("Tagline")).toHaveValue(tagline);
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
