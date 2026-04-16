import { test, expect } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import { signIn } from "./helpers/sign-in";

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
