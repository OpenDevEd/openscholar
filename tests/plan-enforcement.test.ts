import { describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import { selectCanonicalSubscription } from "../convex/subscriptions/lib/selectCanonicalSubscription";
import { requireFeature } from "../convex/featureFlags/guard";
import { createMockSubscription, mockId } from "./factories";
import type { Doc } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";

// --- Helpers ---

function makeSub(overrides?: Partial<Omit<Doc<"subscriptions">, "_id" | "_creationTime">>): Doc<"subscriptions"> {
  return createMockSubscription(overrides);
}

/**
 * Build a mock MutationCtx whose db.query returns the correct chain
 * depending on the table name:
 *   - "featureFlags" -> withIndex().unique() returns the given flag doc
 *   - "subscriptions" -> withIndex().order().collect() returns the given subscriptions
 */
function createFeatureFlagCtx(
  flag: { key: string; enabled: boolean; minimumTier: number; description?: string } | null,
  subscriptions: Doc<"subscriptions">[] = [],
): MutationCtx {
  const flagDoc = flag
    ? { _id: mockId("featureFlags" as never), _creationTime: Date.now(), ...flag }
    : null;

  return {
    db: {
      query: vi.fn().mockImplementation((table: string) => {
        if (table === "featureFlags") {
          return {
            withIndex: vi.fn().mockReturnValue({
              unique: vi.fn().mockResolvedValue(flagDoc),
            }),
          };
        }
        if (table === "subscriptions") {
          return {
            withIndex: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                collect: vi.fn().mockResolvedValue(subscriptions),
              }),
            }),
          };
        }
        return {
          withIndex: vi.fn().mockReturnValue({
            unique: vi.fn().mockResolvedValue(null),
            order: vi.fn().mockReturnValue({
              collect: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
      }),
      get: vi.fn().mockResolvedValue(null),
    },
    auth: {
      getUserIdentity: vi.fn().mockResolvedValue(null),
    },
    scheduler: {
      runAfter: vi.fn(),
      runAt: vi.fn(),
    },
  } as unknown as MutationCtx;
}

// --- selectCanonicalSubscription tests (PLAN-05) ---

describe("selectCanonicalSubscription", () => {
  it("returns null for empty array", () => {
    expect(selectCanonicalSubscription([])).toBeNull();
  });

  it("priority 1: non-canceled paid with Stripe ID wins over all", () => {
    const subs = [
      makeSub({ plan: "free", status: "active" }),
      makeSub({
        plan: "go",
        status: "active",
        stripeSubscriptionId: "sub_123",
      }),
    ];
    expect(selectCanonicalSubscription(subs)).toBe(subs[1]);
  });

  it("priority 2: non-canceled paid without Stripe ID wins over free", () => {
    const subs = [
      makeSub({ plan: "free", status: "active" }),
      makeSub({ plan: "pro", status: "active" }),
    ];
    expect(selectCanonicalSubscription(subs)).toBe(subs[1]);
  });

  it("priority 3: non-canceled free wins over canceled free", () => {
    const subs = [
      makeSub({ plan: "free", status: "canceled" }),
      makeSub({ plan: "free", status: "active" }),
    ];
    expect(selectCanonicalSubscription(subs)).toBe(subs[1]);
  });

  it("priority 4: any free wins over canceled paid with Stripe ID", () => {
    const subs = [
      makeSub({
        plan: "go",
        status: "canceled",
        stripeSubscriptionId: "sub_456",
      }),
      makeSub({ plan: "free", status: "canceled" }),
    ];
    expect(selectCanonicalSubscription(subs)).toBe(subs[1]);
  });

  it("priority 5: any with Stripe ID wins over record without", () => {
    const subs = [
      makeSub({ plan: "go", status: "canceled" }),
      makeSub({
        plan: "pro",
        status: "canceled",
        stripeSubscriptionId: "sub_789",
      }),
    ];
    expect(selectCanonicalSubscription(subs)).toBe(subs[1]);
  });

  it("priority 6: falls back to first record", () => {
    const subs = [
      makeSub({ plan: "go", status: "canceled" }),
      makeSub({ plan: "pro", status: "canceled" }),
    ];
    expect(selectCanonicalSubscription(subs)).toBe(subs[0]);
  });

  it("single subscription is always returned", () => {
    const sub = makeSub({
      plan: "go",
      status: "active",
      stripeSubscriptionId: "sub_x",
    });
    expect(selectCanonicalSubscription([sub])).toBe(sub);
  });
});

// --- requireFeature tests ---

describe("requireFeature", () => {
  it("throws FEATURE_DISABLED when flag does not exist", async () => {
    const ctx = createFeatureFlagCtx(null);
    try {
      await requireFeature(ctx, "extraction.enabled");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string; message: string }>;
      expect(convexErr.data.code).toBe("FEATURE_DISABLED");
    }
  });

  it("throws FEATURE_DISABLED when flag is disabled", async () => {
    const ctx = createFeatureFlagCtx({
      key: "extraction.enabled",
      enabled: false,
      minimumTier: 0,
    });
    try {
      await requireFeature(ctx, "extraction.enabled");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string; message: string }>;
      expect(convexErr.data.code).toBe("FEATURE_DISABLED");
    }
  });

  it("passes when flag is enabled with no tier requirement", async () => {
    const ctx = createFeatureFlagCtx({
      key: "credits.enabled",
      enabled: true,
      minimumTier: 0,
    });
    await expect(requireFeature(ctx, "credits.enabled")).resolves.toBeUndefined();
  });

  it("passes when user tier meets minimum", async () => {
    const ctx = createFeatureFlagCtx(
      {
        key: "extraction.reportBuilder",
        enabled: true,
        minimumTier: 10,
        description: "AI Insights",
      },
      [
        makeSub({
          plan: "go",
          status: "active",
          stripeSubscriptionId: "sub_go",
        }),
      ],
    );
    await expect(
      requireFeature(ctx, "extraction.reportBuilder", mockId("users", "1")),
    ).resolves.toBeUndefined();
  });

  it("throws FEATURE_PLAN_REQUIRED when tier is below minimum", async () => {
    const ctx = createFeatureFlagCtx(
      {
        key: "extraction.reportBuilder",
        enabled: true,
        minimumTier: 10,
        description: "AI Insights",
      },
      [makeSub({ plan: "free", status: "active" })],
    );
    try {
      await requireFeature(ctx, "extraction.reportBuilder", mockId("users", "1"));
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string; message: string }>;
      expect(convexErr.data.code).toBe("FEATURE_PLAN_REQUIRED");
      expect(convexErr.data.message).toContain("requires a higher plan");
    }
  });

  it("passes when user tier exceeds minimum", async () => {
    const ctx = createFeatureFlagCtx(
      {
        key: "extraction.start",
        enabled: true,
        minimumTier: 20,
        description: "Start Extraction",
      },
      [
        makeSub({
          plan: "enterprise",
          status: "active",
          stripeSubscriptionId: "sub_ent",
        }),
      ],
    );
    await expect(
      requireFeature(ctx, "extraction.start", mockId("users", "1")),
    ).resolves.toBeUndefined();
  });

  it("treats canceled subscription as free tier", async () => {
    const ctx = createFeatureFlagCtx(
      {
        key: "extraction.reportBuilder",
        enabled: true,
        minimumTier: 10,
        description: "AI Insights",
      },
      [
        makeSub({
          plan: "go",
          status: "canceled",
          stripeSubscriptionId: "sub_go",
        }),
      ],
    );
    try {
      await requireFeature(ctx, "extraction.reportBuilder", mockId("users", "1"));
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string; message: string }>;
      expect(convexErr.data.code).toBe("FEATURE_PLAN_REQUIRED");
    }
  });

  it("throws UNAUTHENTICATED when tier-gated flag is checked without userId", async () => {
    const ctx = createFeatureFlagCtx({
      key: "extraction.reportBuilder",
      enabled: true,
      minimumTier: 10,
    });
    try {
      await requireFeature(ctx, "extraction.reportBuilder");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string; message: string }>;
      expect(convexErr.data.code).toBe("UNAUTHENTICATED");
    }
  });

  it("includes description in error message when available", async () => {
    const ctx = createFeatureFlagCtx(
      {
        key: "extraction.start",
        enabled: true,
        minimumTier: 20,
        description: "Start Extraction",
      },
      [makeSub({ plan: "free", status: "active" })],
    );
    try {
      await requireFeature(ctx, "extraction.start", mockId("users", "1"));
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string; message: string }>;
      expect(convexErr.data.message).toContain("Start Extraction");
    }
  });

  it("passes for enterprise user at any tier check", async () => {
    const ctx = createFeatureFlagCtx(
      {
        key: "extraction.start",
        enabled: true,
        minimumTier: 20,
        description: "Start Extraction",
      },
      [
        makeSub({
          plan: "enterprise",
          status: "active",
          stripeSubscriptionId: "sub_ent",
        }),
      ],
    );
    await expect(
      requireFeature(ctx, "extraction.start", mockId("users", "1")),
    ).resolves.toBeUndefined();
  });
});
