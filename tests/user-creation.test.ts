import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createUserWithDefaults } from "../convex/lib/userCreation";
import { FREE_SIGNUP_CREDIT_GRANT, PLAN_CONFIG } from "../convex/lib/constants";
import type { MutationCtx } from "../convex/_generated/server";

const FIXED_TIME = new Date("2026-01-15T12:00:00Z").getTime();

function createMockMutationCtx() {
  const inserts: Array<{ table: string; doc: Record<string, unknown> }> = [];
  return {
    ctx: {
      db: {
        insert: vi.fn(async (table: string, doc: Record<string, unknown>) => {
          inserts.push({ table, doc });
          return `mock_${table}_id`;
        }),
      },
    } as unknown as MutationCtx,
    inserts,
  };
}

describe("createUserWithDefaults", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("makes exactly 3 db.insert calls (atomicity)", async () => {
    const { ctx } = createMockMutationCtx();

    await createUserWithDefaults(ctx, {
      clerkId: "clerk_123",
      email: "test@example.com",
    });

    expect(ctx.db.insert).toHaveBeenCalledTimes(3);
  });

  it("first insert is users table with state active", async () => {
    const { ctx, inserts } = createMockMutationCtx();

    await createUserWithDefaults(ctx, {
      clerkId: "clerk_123",
      email: "test@example.com",
    });

    expect(inserts[0].table).toBe("users");
    expect(inserts[0].doc).toMatchObject({
      clerkId: "clerk_123",
      email: "test@example.com",
      state: "active",
    });
    expect(inserts[0].doc.createdAt).toBe(FIXED_TIME);
    expect(inserts[0].doc.updatedAt).toBe(FIXED_TIME);
    expect(inserts[0].doc.lastLoginAt).toBe(FIXED_TIME);
  });

  it("second insert is credits table with correct freeBalance", async () => {
    const { ctx, inserts } = createMockMutationCtx();

    await createUserWithDefaults(ctx, {
      clerkId: "clerk_123",
      email: "test@example.com",
    });

    expect(inserts[1].table).toBe("credits");
    expect(inserts[1].doc).toMatchObject({
      userId: "mock_users_id",
      freeBalance: 2000,
      paidBalance: 0,
      lifetimeUsed: 0,
    });
    expect(inserts[1].doc.lastUpdatedAt).toBe(FIXED_TIME);
  });

  it("third insert is subscriptions table with plan free and status active", async () => {
    const { ctx, inserts } = createMockMutationCtx();

    await createUserWithDefaults(ctx, {
      clerkId: "clerk_123",
      email: "test@example.com",
    });

    expect(inserts[2].table).toBe("subscriptions");
    expect(inserts[2].doc).toMatchObject({
      userId: "mock_users_id",
      plan: "free",
      status: "active",
      creditsPerMonth: PLAN_CONFIG.free.creditsPerMonth,
      seats: 1,
    });
    expect(inserts[2].doc.createdAt).toBe(FIXED_TIME);
    expect(inserts[2].doc.updatedAt).toBe(FIXED_TIME);
  });

  it("returns the userId from the users insert", async () => {
    const { ctx } = createMockMutationCtx();

    const result = await createUserWithDefaults(ctx, {
      clerkId: "clerk_123",
      email: "test@example.com",
    });

    expect(result).toBe("mock_users_id");
  });

  it("passes optional profile fields to users table", async () => {
    const { ctx, inserts } = createMockMutationCtx();

    await createUserWithDefaults(ctx, {
      clerkId: "clerk_123",
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
      avatarUrl: "https://example.com/avatar.jpg",
    });

    expect(inserts[0].doc).toMatchObject({
      firstName: "Test",
      lastName: "User",
      avatarUrl: "https://example.com/avatar.jpg",
    });
  });

  it("omits undefined optional fields from user insert", async () => {
    const { ctx, inserts } = createMockMutationCtx();

    await createUserWithDefaults(ctx, {
      clerkId: "clerk_123",
      email: "test@example.com",
    });

    // The spread ...userData should not add firstName/lastName/avatarUrl keys
    // when they are not provided in the input
    expect(inserts[0].doc.clerkId).toBe("clerk_123");
    expect(inserts[0].doc.email).toBe("test@example.com");
    expect("firstName" in inserts[0].doc).toBe(false);
    expect("lastName" in inserts[0].doc).toBe(false);
    expect("avatarUrl" in inserts[0].doc).toBe(false);
  });

  it("credits freeBalance matches FREE_SIGNUP_CREDIT_GRANT constant", async () => {
    const { ctx, inserts } = createMockMutationCtx();

    await createUserWithDefaults(ctx, {
      clerkId: "clerk_123",
      email: "test@example.com",
    });

    // The free plan cap equals FREE_SIGNUP_CREDIT_GRANT (2000),
    // so applyTierFreeCreditCap({ plan: "free", currentFreeBalance: 0, amountToAdd: 2000 })
    // returns newFreeBalance = 2000
    expect(inserts[1].doc.freeBalance).toBe(FREE_SIGNUP_CREDIT_GRANT);
  });
});
