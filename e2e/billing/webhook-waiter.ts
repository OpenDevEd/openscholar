import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Snapshot of billing state from Convex, matching the shape returned by
 * testing/billing:getBillingSnapshotForUser internal query.
 */
export type BillingSnapshot = {
  user: {
    _id: string;
    clerkId: string;
    email: string;
    state: string;
  } | null;
  credits: Array<{
    freeBalance: number;
    paidBalance: number;
    lifetimeUsed: number;
  }>;
  subscriptions: Array<{
    plan: string;
    status: string;
    stripeSubscriptionId?: string;
    stripeCustomerId?: string;
    creditsPerMonth?: number;
  }>;
  billingCustomers: Array<{
    stripeCustomerId: string;
  }>;
};

/**
 * Polls Convex backend for billing state convergence.
 *
 * After Stripe API calls (subscription creation, payment, plan change),
 * webhooks are processed asynchronously by Convex. This utility blocks
 * until the expected state is reflected in the Convex database before
 * the test proceeds to make UI assertions.
 *
 * Uses `npx convex run` CLI to query the internal testing function.
 *
 * Usage:
 * ```typescript
 * const waiter = new WebhookWaiter(convexUserId);
 * await waiter.waitForSubscriptionPlan("go");
 * await waiter.waitForCreditBalance((total) => total >= 3000);
 * ```
 */
export class WebhookWaiter {
  constructor(
    private convexUserId: string,
    private defaultTimeoutMs: number = 30_000,
    private intervalMs: number = 2_500,
  ) {}

  /**
   * Wait for the user's subscription to reach the expected plan and active status.
   */
  async waitForSubscriptionPlan(
    expectedPlan: string,
    timeoutMs?: number,
  ): Promise<void> {
    await this.waitForCondition(
      `subscription plan = "${expectedPlan}"`,
      async () => {
        const snapshot = await this.getBillingSnapshot();
        const sub = snapshot.subscriptions[0];
        return sub?.plan === expectedPlan && sub?.status === "active"
          ? true
          : null;
      },
      timeoutMs,
    );
  }

  /**
   * Wait for the user's total credit balance to satisfy a predicate.
   */
  async waitForCreditBalance(
    predicate: (totalBalance: number) => boolean,
    timeoutMs?: number,
  ): Promise<number> {
    return await this.waitForCondition(
      "credit balance matches predicate",
      async () => {
        const snapshot = await this.getBillingSnapshot();
        const credits = snapshot.credits[0];
        if (!credits) return null;
        const total = credits.freeBalance + credits.paidBalance;
        return predicate(total) ? total : null;
      },
      timeoutMs,
    );
  }

  /**
   * Wait for a billing customer link to exist for the user.
   */
  async waitForBillingCustomerLink(timeoutMs?: number): Promise<string> {
    return await this.waitForCondition(
      "billing customer link exists",
      async () => {
        const snapshot = await this.getBillingSnapshot();
        const customer = snapshot.billingCustomers[0];
        return customer?.stripeCustomerId ?? null;
      },
      timeoutMs,
    );
  }

  /**
   * Get the current billing snapshot without waiting.
   */
  async getBillingSnapshot(): Promise<BillingSnapshot> {
    return await this.runConvexQuery(
      "testing/billing:getBillingSnapshotForUser",
      { userId: this.convexUserId },
    );
  }

  /**
   * Reset all billing state for the user in Convex.
   * Called during fixture teardown.
   */
  async resetBillingState(): Promise<void> {
    await this.runConvexQuery(
      "testing/billing:resetBillingStateForUser",
      { userId: this.convexUserId },
    );
  }

  /**
   * Poll a condition until it returns a non-null value or times out.
   * Adapted from tests/live-billing/support.ts waitForCondition.
   */
  private async waitForCondition<T>(
    description: string,
    check: () => Promise<T | null>,
    timeoutMs?: number,
  ): Promise<T> {
    const timeout = timeoutMs ?? this.defaultTimeoutMs;
    const startedAt = Date.now();
    let lastError: string | null = null;

    while (Date.now() - startedAt <= timeout) {
      try {
        const value = await check();
        if (value !== null && value !== undefined) {
          return value;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((r) => setTimeout(r, this.intervalMs));
    }

    const suffix = lastError ? ` Last error: ${lastError}` : "";
    throw new Error(
      `WebhookWaiter: timed out waiting for ${description} after ${timeout}ms.${suffix}`,
    );
  }

  /**
   * Run a Convex internal function via CLI.
   * Adapted from tests/live-billing/support.ts runConvexFunction.
   */
  private async runConvexQuery<T>(
    functionPath: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const cliArgs = [
      "convex",
      "run",
      functionPath,
      JSON.stringify(payload),
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
      maxBuffer: 1024 * 1024 * 8,
      timeout: 15_000,
    });

    const trimmed = stdout.trim();
    if (!trimmed) {
      throw new Error(`Empty response from convex run ${functionPath}`);
    }

    // Parse stdout -- handle Convex CLI output format
    const lastLine = trimmed.split("\n").at(-1)?.trim() ?? "";
    for (const attempt of [trimmed, lastLine]) {
      try {
        return JSON.parse(attempt) as T;
      } catch {
        // Try next
      }
    }

    throw new Error(
      `Failed to parse convex run output for ${functionPath}: ${trimmed.slice(0, 200)}`,
    );
  }
}
