import { describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import { selectCanonicalSubscription } from "../convex/subscriptions/lib/selectCanonicalSubscription";
import { requirePlanTier } from "../convex/extraction/guard";

// --- Helpers ---

function makeSub(overrides: Partial<any> = {}): any {
  return {
    _id: "sub_default",
    _creationTime: 0,
    userId: "user_1",
    plan: "free",
    status: "active",
    creditsPerMonth: 0,
    seats: 1,
    stripeSubscriptionId: undefined,
    ...overrides,
  };
}

function createMockCtx(subscriptions: any[]) {
  return {
    db: {
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            collect: vi.fn().mockResolvedValue(subscriptions),
          }),
        }),
      }),
    },
  };
}

// --- selectCanonicalSubscription tests (PLAN-05) ---

describe("selectCanonicalSubscription", () => {
  it("returns null for empty array", () => {
    expect(selectCanonicalSubscription([])).toBeNull();
  });

  it("priority 1: non-canceled paid with Stripe ID wins over all", () => {
    const subs = [
      makeSub({ _id: "free_active", plan: "free", status: "active" }),
      makeSub({
        _id: "go_stripe",
        plan: "go",
        status: "active",
        stripeSubscriptionId: "sub_123",
      }),
    ];
    expect(selectCanonicalSubscription(subs)).toBe(subs[1]);
  });

  it("priority 2: non-canceled paid without Stripe ID wins over free", () => {
    const subs = [
      makeSub({ _id: "free_active", plan: "free", status: "active" }),
      makeSub({ _id: "pro_no_stripe", plan: "pro", status: "active" }),
    ];
    expect(selectCanonicalSubscription(subs)).toBe(subs[1]);
  });

  it("priority 3: non-canceled free wins over canceled free", () => {
    const subs = [
      makeSub({ _id: "free_canceled", plan: "free", status: "canceled" }),
      makeSub({ _id: "free_active", plan: "free", status: "active" }),
    ];
    expect(selectCanonicalSubscription(subs)).toBe(subs[1]);
  });

  it("priority 4: any free wins over canceled paid with Stripe ID", () => {
    const subs = [
      makeSub({
        _id: "go_canceled_stripe",
        plan: "go",
        status: "canceled",
        stripeSubscriptionId: "sub_456",
      }),
      makeSub({ _id: "free_canceled", plan: "free", status: "canceled" }),
    ];
    expect(selectCanonicalSubscription(subs)).toBe(subs[1]);
  });

  it("priority 5: any with Stripe ID wins over record without", () => {
    const subs = [
      makeSub({ _id: "go_canceled", plan: "go", status: "canceled" }),
      makeSub({
        _id: "pro_canceled_stripe",
        plan: "pro",
        status: "canceled",
        stripeSubscriptionId: "sub_789",
      }),
    ];
    expect(selectCanonicalSubscription(subs)).toBe(subs[1]);
  });

  it("priority 6: falls back to first record", () => {
    const subs = [
      makeSub({ _id: "go_canceled_1", plan: "go", status: "canceled" }),
      makeSub({ _id: "pro_canceled_2", plan: "pro", status: "canceled" }),
    ];
    expect(selectCanonicalSubscription(subs)).toBe(subs[0]);
  });

  it("single subscription is always returned", () => {
    const sub = makeSub({
      _id: "only_one",
      plan: "go",
      status: "active",
      stripeSubscriptionId: "sub_x",
    });
    expect(selectCanonicalSubscription([sub])).toBe(sub);
  });
});

// --- requirePlanTier tests (PLAN-03) ---

describe("requirePlanTier", () => {
  it("passes when user tier meets minimum", async () => {
    const ctx = createMockCtx([
      makeSub({
        plan: "go",
        status: "active",
        stripeSubscriptionId: "sub_go",
      }),
    ]);
    await expect(
      requirePlanTier(ctx as any, "user_1" as any, 10, "Extraction"),
    ).resolves.toBeUndefined();
  });

  it("throws EXTRACTION_PLAN_REQUIRED when tier is below minimum", async () => {
    const ctx = createMockCtx([
      makeSub({ plan: "free", status: "active" }),
    ]);
    try {
      await requirePlanTier(ctx as any, "user_1" as any, 10, "Extraction");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string; message: string }>;
      expect(convexErr.data.code).toBe("EXTRACTION_PLAN_REQUIRED");
      expect(convexErr.data.message).toContain(
        "Extraction requires a higher plan",
      );
    }
  });

  it("passes when user tier exceeds minimum", async () => {
    const ctx = createMockCtx([
      makeSub({
        plan: "pro",
        status: "active",
        stripeSubscriptionId: "sub_pro",
      }),
    ]);
    await expect(
      requirePlanTier(ctx as any, "user_1" as any, 10, "Extraction"),
    ).resolves.toBeUndefined();
  });

  it("treats canceled subscription as free tier", async () => {
    const ctx = createMockCtx([
      makeSub({
        plan: "go",
        status: "canceled",
        stripeSubscriptionId: "sub_go",
      }),
    ]);
    try {
      await requirePlanTier(ctx as any, "user_1" as any, 10, "Extraction");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string; message: string }>;
      expect(convexErr.data.code).toBe("EXTRACTION_PLAN_REQUIRED");
    }
  });

  it("passes for enterprise user at any tier check", async () => {
    const ctx = createMockCtx([
      makeSub({
        plan: "enterprise",
        status: "active",
        stripeSubscriptionId: "sub_ent",
      }),
    ]);
    await expect(
      requirePlanTier(ctx as any, "user_1" as any, 30, "Premium Feature"),
    ).resolves.toBeUndefined();
  });

  it("throws for free user trying to access Go-tier feature", async () => {
    const ctx = createMockCtx([
      makeSub({ plan: "free", status: "active" }),
    ]);
    try {
      await requirePlanTier(
        ctx as any,
        "user_1" as any,
        10,
        "PDF Processing",
      );
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string; message: string }>;
      expect(convexErr.data.message).toContain(
        "PDF Processing requires a higher plan",
      );
    }
  });

  it("includes feature name in error message", async () => {
    const ctx = createMockCtx([
      makeSub({ plan: "free", status: "active" }),
    ]);
    try {
      await requirePlanTier(
        ctx as any,
        "user_1" as any,
        10,
        "Custom Feature",
      );
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string; message: string }>;
      expect(convexErr.data.message).toContain("Custom Feature");
    }
  });
});
