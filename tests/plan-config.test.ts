import { describe, expect, it, vi, afterEach } from "vitest";
import {
  PLAN_CONFIG,
  FREE_SIGNUP_CREDIT_GRANT,
  getPlanTier,
  getFreeCreditCapForPlan,
  getPlanFromPriceId,
} from "../convex/lib/constants";

describe("PLAN_CONFIG shape contract", () => {
  it("has exactly four plans", () => {
    expect(Object.keys(PLAN_CONFIG)).toEqual([
      "free",
      "go",
      "pro",
      "enterprise",
    ]);
  });

  it("free plan has correct values", () => {
    expect(PLAN_CONFIG.free).toEqual({
      creditsPerMonth: 0,
      tier: 0,
      freeCreditCap: FREE_SIGNUP_CREDIT_GRANT,
    });
  });

  it("go plan has correct values", () => {
    expect(PLAN_CONFIG.go).toEqual({
      creditsPerMonth: 3_000,
      tier: 10,
      freeCreditCap: 6_000,
    });
  });

  it("pro plan has correct values", () => {
    expect(PLAN_CONFIG.pro).toEqual({
      creditsPerMonth: 15_000,
      tier: 20,
      freeCreditCap: 30_000,
    });
  });

  it("enterprise plan has correct values", () => {
    expect(PLAN_CONFIG.enterprise).toEqual({
      creditsPerMonth: 150_000,
      tier: 30,
      freeCreditCap: 300_000,
    });
  });

  it("free plan freeCreditCap equals FREE_SIGNUP_CREDIT_GRANT", () => {
    expect(PLAN_CONFIG.free.freeCreditCap).toBe(FREE_SIGNUP_CREDIT_GRANT);
  });
});

describe("getPlanTier", () => {
  it.each([
    ["free", 0],
    ["go", 10],
    ["pro", 20],
    ["enterprise", 30],
  ] as const)("returns %d for '%s' plan", (plan, expected) => {
    expect(getPlanTier(plan)).toBe(expected);
  });

  it("returns 0 for unknown plan", () => {
    expect(getPlanTier("unknown" as any)).toBe(0);
  });
});

describe("getFreeCreditCapForPlan", () => {
  it.each([
    ["free", 2_000],
    ["go", 6_000],
    ["pro", 30_000],
    ["enterprise", 300_000],
  ] as const)("returns %d for '%s' plan", (plan, expected) => {
    expect(getFreeCreditCapForPlan(plan)).toBe(expected);
  });

  it("returns free plan cap for unknown plan", () => {
    expect(getFreeCreditCapForPlan("unknown" as any)).toBe(
      FREE_SIGNUP_CREDIT_GRANT,
    );
  });
});

describe("getPlanFromPriceId", () => {
  it("returns free for undefined priceId", () => {
    expect(getPlanFromPriceId(undefined)).toBe("free");
  });

  it("returns free for empty string priceId", () => {
    expect(getPlanFromPriceId("")).toBe("free");
  });

  it("returns free for unknown priceId", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getPlanFromPriceId("price_unknown_xyz")).toBe("free");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("price_unknown_xyz"),
    );
    warnSpy.mockRestore();
  });

  it("returns free (not enterprise) for priceId containing 'enterprise' after BILL-01", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getPlanFromPriceId("price_enterprise_monthly")).toBe("free");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns free (not pro) for priceId containing 'pro' after BILL-01", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getPlanFromPriceId("price_pro_annual")).toBe("free");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns go for GO_PRICE_ID match", async () => {
    process.env.STRIPE_GO_PRICE_ID = "price_go_test";
    vi.resetModules();
    const { getPlanFromPriceId: freshGetPlan } = await import(
      "../convex/lib/constants"
    );
    expect(freshGetPlan("price_go_test")).toBe("go");
    delete process.env.STRIPE_GO_PRICE_ID;
  });

  it("returns pro for PRO_PRICE_ID match", async () => {
    process.env.STRIPE_PRO_PRICE_ID = "price_pro_test";
    vi.resetModules();
    const { getPlanFromPriceId: freshGetPlan } = await import(
      "../convex/lib/constants"
    );
    expect(freshGetPlan("price_pro_test")).toBe("pro");
    delete process.env.STRIPE_PRO_PRICE_ID;
  });

  it("returns enterprise for ENTERPRISE_PRICE_ID match", async () => {
    process.env.STRIPE_ENTERPRISE_PRICE_ID = "price_ent_test";
    vi.resetModules();
    const { getPlanFromPriceId: freshGetPlan } = await import(
      "../convex/lib/constants"
    );
    expect(freshGetPlan("price_ent_test")).toBe("enterprise");
    delete process.env.STRIPE_ENTERPRISE_PRICE_ID;
  });
});

// BILL-01: Substring fallback removed -- all non-exact-match IDs now return "free" with console.warn
describe("getPlanFromPriceId after BILL-01 (no substring fallback)", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.STRIPE_GO_PRICE_ID;
    delete process.env.STRIPE_PRO_PRICE_ID;
    delete process.env.STRIPE_ENTERPRISE_PRICE_ID;
  });

  it('returns "free" for "price_test_enterprise_monthly" (substring fallback removed)', () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getPlanFromPriceId("price_test_enterprise_monthly")).toBe("free");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("price_test_enterprise_monthly"),
    );
    warnSpy.mockRestore();
  });

  it('returns "free" for "price_test_pro_annual" (substring fallback removed)', () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getPlanFromPriceId("price_test_pro_annual")).toBe("free");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("price_test_pro_annual"),
    );
    warnSpy.mockRestore();
  });

  it('returns "free" for "price_enterprise_pro_combo" (substring fallback removed)', () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getPlanFromPriceId("price_enterprise_pro_combo")).toBe("free");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("price_enterprise_pro_combo"),
    );
    warnSpy.mockRestore();
  });

  it('returns "free" for "price_basic_monthly" (no match)', () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getPlanFromPriceId("price_basic_monthly")).toBe("free");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("price_basic_monthly"),
    );
    warnSpy.mockRestore();
  });

  it("exact match takes precedence over fallback", async () => {
    process.env.STRIPE_PRO_PRICE_ID = "price_enterprise_special";
    vi.resetModules();
    const { getPlanFromPriceId: freshGetPlan } = await import(
      "../convex/lib/constants"
    );
    // Exact PRO_PRICE_ID match wins -- no warning logged
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(freshGetPlan("price_enterprise_special")).toBe("pro");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    delete process.env.STRIPE_PRO_PRICE_ID;
  });
});

describe("Feature flag guards", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_CREDITS_ENABLED;
    delete process.env.NEXT_PUBLIC_CREDIT_TOPUPS_ENABLED;
    delete process.env.NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED;
  });

  it("requireCreditsEnabled passes when env not set", async () => {
    const { requireCreditsEnabled } = await import(
      "../convex/lib/featureFlags"
    );
    expect(() => requireCreditsEnabled()).not.toThrow();
  });

  it("requireCreditsEnabled throws when disabled", async () => {
    process.env.NEXT_PUBLIC_CREDITS_ENABLED = "false";
    const { requireCreditsEnabled } = await import(
      "../convex/lib/featureFlags"
    );
    expect(() => requireCreditsEnabled()).toThrow("Credits feature is disabled");
  });

  it("requireCreditTopupsEnabled passes when env not set", async () => {
    const { requireCreditTopupsEnabled } = await import(
      "../convex/lib/featureFlags"
    );
    expect(() => requireCreditTopupsEnabled()).not.toThrow();
  });

  it("requireCreditTopupsEnabled throws when disabled", async () => {
    process.env.NEXT_PUBLIC_CREDIT_TOPUPS_ENABLED = "false";
    const { requireCreditTopupsEnabled } = await import(
      "../convex/lib/featureFlags"
    );
    expect(() => requireCreditTopupsEnabled()).toThrow(
      "Credit top-ups feature is disabled",
    );
  });

  it("requireSubscriptionsEnabled passes when env not set", async () => {
    const { requireSubscriptionsEnabled } = await import(
      "../convex/lib/featureFlags"
    );
    expect(() => requireSubscriptionsEnabled()).not.toThrow();
  });

  it("requireSubscriptionsEnabled throws when disabled", async () => {
    process.env.NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED = "false";
    const { requireSubscriptionsEnabled } = await import(
      "../convex/lib/featureFlags"
    );
    expect(() => requireSubscriptionsEnabled()).toThrow(
      "Subscriptions feature is disabled",
    );
  });
});
