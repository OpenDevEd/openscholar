import { test as base, expect } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import type Stripe from "stripe";
import { createStripeClient, cleanupStripeCustomer } from "./stripe-helpers";
import { WebhookWaiter } from "./webhook-waiter";
import { BillingPage } from "./pages/billing-page";
import { PricingPage } from "./pages/pricing-page";
import { createDisposableClerkUser, deleteClerkUser } from "../clerk-test-user";

/**
 * Shape of the Clerk test user created by the fixture.
 */
type ClerkTestUser = {
  id: string;
  email: string;
};

/**
 * Fixtures provided to every billing E2E test.
 */
type BillingFixtures = {
  /** Fresh Clerk user, signed in, auto-cleaned on teardown */
  clerkUser: ClerkTestUser;
  /** Pre-configured Stripe SDK client */
  stripeClient: Stripe;
  /** Webhook waiter bound to the test user's Convex ID */
  webhookWaiter: WebhookWaiter;
  /** BillingPage POM instance */
  billingPage: BillingPage;
  /** PricingPage POM instance */
  pricingPage: PricingPage;
};

/**
 * Billing test fixture that composes user lifecycle, Stripe client,
 * webhook waiter, and page objects into a single test extension.
 *
 * Usage in Phase 8/9 specs:
 * ```typescript
 * import { test, expect } from "../fixtures";
 *
 * test("user subscribes to Go plan", async ({ clerkUser, stripeClient, webhookWaiter, billingPage }) => {
 *   // ... test body (~10-15 lines)
 * });
 * ```
 */
export const test = base.extend<BillingFixtures>({
  // --- clerkUser fixture ---
  // Creates a fresh Clerk user per test, signs in, and cleans up on teardown.
  clerkUser: async ({ page }, use) => {
    if (!process.env.CLERK_SECRET_KEY) {
      throw new Error("Missing CLERK_SECRET_KEY for billing E2E tests");
    }
    const organizationId = process.env.E2E_CLERK_ORGANIZATION_ID;
    if (!organizationId) {
      throw new Error(
        "Missing E2E_CLERK_ORGANIZATION_ID for billing E2E tests",
      );
    }

    const user = await createDisposableClerkUser({
      prefix: "billing-e2e",
      firstName: "E2E",
      lastName: "Billing",
      organizationId,
    });

    // Sign in to the browser session
    await page.goto("/");
    await clerk.loaded({ page });
    await clerk.signIn({
      page,
      emailAddress: user.email,
    });
    await page.evaluate(async (activeOrganizationId) => {
      await window.Clerk.setActive({ organization: activeOrganizationId });
    }, organizationId);
    await page.reload();

    // Navigate to a protected page to trigger ensureUser in Convex
    // This creates the Convex user row via the Clerk webhook
    await page.goto("/settings/billing");
    // Wait for the page to finish loading (subscription state settles)
    await page.waitForLoadState("networkidle");

    await use({ id: user.id, email: user.email });

    // Teardown: sign out and delete the Clerk user
    try {
      await clerk.signOut({ page });
    } catch {
      // Best-effort -- page may have navigated away
    }
    await deleteClerkUser(user.id);
  },

  // --- stripeClient fixture ---
  // eslint-disable-next-line no-empty-pattern
  stripeClient: async ({}, use) => {
    const stripe = createStripeClient();
    await use(stripe);
  },

  // --- webhookWaiter fixture ---
  // Waits for clerkUser to be available, discovers Convex userId,
  // creates WebhookWaiter bound to that user, and resets state on teardown.
  webhookWaiter: async ({ clerkUser }, use) => {
    // Discover the Convex userId by querying with the Clerk user identity.
    // The Convex user is created by the ensureUser mutation triggered during
    // page navigation in the clerkUser fixture.
    //
    // We use convex run with an identity to call ensureUser which returns
    // the Convex userId.
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    const identity = {
      subject: clerkUser.id,
      email: clerkUser.email,
      givenName: "E2E",
      familyName: "Billing",
    };

    const cliArgs = [
      "convex",
      "run",
      "users/mutations:ensureUser",
      JSON.stringify({}),
      "--identity",
      JSON.stringify(identity),
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
    ];

    if (process.env.CONVEX_DEPLOYMENT_NAME) {
      cliArgs.push("--deployment-name", process.env.CONVEX_DEPLOYMENT_NAME);
    }

    const { stdout } = await execFileAsync("npx", cliArgs, {
      env: process.env,
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    });

    const convexUserId = stdout.trim().split("\n").at(-1)?.trim();
    if (!convexUserId) {
      throw new Error("Failed to discover Convex userId for billing test user");
    }

    // Parse the userId -- may be JSON-quoted string
    let parsedUserId: string;
    try {
      parsedUserId = JSON.parse(convexUserId);
    } catch {
      parsedUserId = convexUserId;
    }

    const waiter = new WebhookWaiter(parsedUserId);
    await use(waiter);

    // Teardown: hard-delete the test user and all billing data from Convex
    try {
      await waiter.deleteTestUser();
    } catch {
      // Best-effort cleanup
    }
  },

  // --- billingPage fixture ---
  billingPage: async ({ page }, use) => {
    await use(new BillingPage(page));
  },

  // --- pricingPage fixture ---
  pricingPage: async ({ page }, use) => {
    await use(new PricingPage(page));
  },
});

export { expect };
