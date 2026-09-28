/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { createUserWithDefaults } from "../convex/lib/userCreation";
import {
  FAKE_SIGNUP_CREDITS,
  fakeAutumn,
  installFakeAutumn,
} from "../convex/billing/billing.test-support";

describe("createUserWithDefaults", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeAutumn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("gives a new user the signup credits exactly once", async () => {
    const t = convexTest(schema);
    const userId = await t.run((ctx) =>
      createUserWithDefaults(ctx, { clerkId: "clerk_123", email: "test@example.com" }),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const account = await t.run((ctx) =>
      ctx.db
        .query("billingAccounts")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
    );
    expect(account).toMatchObject({ plan: "free", balance: FAKE_SIGNUP_CREDITS, signupGranted: true });

    await t.action(internal.billing.accounts.provision, { userId });
    expect(fakeAutumn.balance(userId)).toBe(FAKE_SIGNUP_CREDITS);
  });
});
