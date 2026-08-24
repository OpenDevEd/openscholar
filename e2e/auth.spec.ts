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
    await page.getByLabel("Library name").fill(libraryName);
    await page.getByRole("button", { name: "Reserve address" }).click();
    await expect(page.getByLabel("Platform address")).toHaveValue(
      /^https:\/\//,
    );
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/evidence-libraries\/[^/]+\/configuration$/);
    const configurationUrl = page.url();

    await page
      .getByLabel("Logo URL")
      .fill("https://assets.example.org/e2e-logo.svg");
    await page
      .getByLabel("Favicon URL")
      .fill("https://assets.example.org/e2e-favicon.ico");
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
    await expect(page.getByLabel("Library name")).toHaveValue(libraryName);
    await expect(page.getByLabel("Logo URL")).toHaveValue(
      "https://assets.example.org/e2e-logo.svg",
    );
    await expect(page.getByLabel("Favicon URL")).toHaveValue(
      "https://assets.example.org/e2e-favicon.ico",
    );
    await expect(page.getByLabel("Platform address")).toHaveAttribute(
      "readonly",
    );
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
