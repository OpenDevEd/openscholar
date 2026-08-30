import { test, expect, type Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";

function requireEnvironment(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} for auth E2E tests.`);
  }
  return value;
}

async function signIn(page: Page) {
  const emailAddress = requireEnvironment("E2E_CLERK_USER_EMAIL");
  const organizationId = requireEnvironment("E2E_CLERK_ORGANIZATION_ID");
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({
    page,
    emailAddress,
  });
  await page.evaluate(
    async (activeOrganizationId) => {
      await window.Clerk.setActive({ organization: activeOrganizationId });
    },
    organizationId,
  );
  await page.reload();
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
    const libraryId = requireEnvironment("E2E_EVIDENCE_LIBRARY_ID");
    const configurationUrl = `/evidence-libraries/${libraryId}/configuration`;
    await page.goto(configurationUrl);

    const tagline = page.getByLabel("Tagline");
    const description = page.getByLabel("Description");
    const originalTagline = await tagline.inputValue();
    const originalDescription = await description.inputValue();
    const run = Date.now();
    const changedTagline = `Evidence checked by CI ${run}`;
    const changedDescription = `OpenScholar auth E2E saved this draft at ${run}.`;

    try {
      await tagline.fill(changedTagline);
      await description.fill(changedDescription);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.locator("[data-unsaved]")).toHaveCount(0);

      await page.goto("/settings");
      await page.goto(configurationUrl);
      await expect(page.getByLabel("Tagline")).toHaveValue(changedTagline);
      await expect(page.getByLabel("Description")).toHaveValue(changedDescription);
      await expect(page.getByLabel("Public address")).toHaveAttribute(
        "aria-readonly",
        "true",
      );
    } finally {
      await page.goto(configurationUrl);
      await page.getByLabel("Tagline").fill(originalTagline);
      await page.getByLabel("Description").fill(originalDescription);
      const restore = page.getByRole("button", { name: "Save", exact: true });
      if (await restore.isEnabled()) {
        await restore.click();
        await expect(page.locator("[data-unsaved]")).toHaveCount(0);
      }
    }
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
