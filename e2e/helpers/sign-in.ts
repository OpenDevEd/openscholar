// e2e/helpers/sign-in.ts
// Extracted from e2e/auth.spec.ts to share sign-in logic across specs.
// Phase 105 D-07.

import type { Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";

export function getTestUserEmail(): string {
  const emailAddress = process.env.E2E_CLERK_USER_EMAIL;
  if (!emailAddress) {
    throw new Error(
      "Missing E2E_CLERK_USER_EMAIL for E2E tests.",
    );
  }
  return emailAddress;
}

export async function signIn(page: Page): Promise<void> {
  const emailAddress = getTestUserEmail();
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({
    page,
    emailAddress,
  });
}
