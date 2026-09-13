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

test("sidebar links keep their names and a single keyboard stop when collapsed or expanded", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await clerk.loaded({ page });
  const expand = page.getByRole("button", { name: "Expand sidebar (Ctrl+B)", exact: true });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  const home = page.getByRole("link", { name: "Home", exact: true });
  const bookmarks = page.getByRole("link", { name: "Bookmarks", exact: true });
  await expect(home).toHaveAttribute("aria-current", "page");
  await home.focus();
  await expect(page.getByRole("tooltip")).toContainText("Home");
  await page.keyboard.press("Tab");
  await expect(bookmarks).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Library", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Screening", exact: true })).toBeVisible();
  const language = page.getByRole("button", { name: /^Language:/ });
  await language.focus();
  await page.keyboard.press("Enter");
  await expect(language).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(language).toBeFocused();
  await expand.click();
  await expect(page.getByRole("button", { name: "Collapse sidebar (Ctrl+B)", exact: true })).toHaveAttribute("aria-expanded", "true");
  await home.focus();
  await page.keyboard.press("Tab");
  await expect(bookmarks).toBeFocused();
});

test("choosing History dismisses the mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await clerk.loaded({ page });
  await page.getByRole("button", { name: "Expand panel", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "History", exact: true }).click();
  await expect(page).toHaveURL(/\/history(?:\?|$)/);
  await expect(drawer).toHaveCount(0);
});

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
    await expect(
      page.getByText("Changes saved.", { exact: true }),
    ).toBeVisible();

    await page.goto("/settings");
    await page.goto(configurationUrl);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      libraryName,
    );
    await expect(page.getByLabel("Tagline")).toHaveValue(tagline);

    await page.goto(`${configurationUrl}?section=versions`);
    const versions = page.locator("#sec-versions");
    await expect(versions).toBeInViewport();
    await page.reload();
    await expect(versions).toBeInViewport();
    await page.getByRole("navigation", { name: "Configuration sections" })
      .getByRole("link", { name: /^Identity/ }).click();
    await expect(page.locator("#sec-identity")).toBeInViewport();
    await page.goto(`${configurationUrl}?section=team`);
    await expect(page.getByRole("button", { name: "Add member", exact: true })).toBeVisible();
    await expect(page.locator("#sec-team")).toBeInViewport();
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
