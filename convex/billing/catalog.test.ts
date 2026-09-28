import { describe, expect, it } from "vitest";
import { catalogFrom } from "./catalog";
import type { AutumnFeature, AutumnPlan } from "./autumn";
import {
  isUpgrade,
  mainPlans,
  planCreditCap,
  plansWithFeature,
  signupCredits,
  topUpBundles,
} from "../../lib/billing/catalog";

// The shape Autumn's plans.list returns, trimmed to the fields read.
const plan = (overrides: Partial<AutumnPlan> & Pick<AutumnPlan, "id">): AutumnPlan => ({
  name: overrides.id,
  description: null,
  group: "main",
  add_on: false,
  auto_enable: false,
  archived: false,
  price: null,
  items: [],
  metadata: {},
  ...overrides,
});

const monthlyCredits = (included: number, rollover: number) => ({
  feature_id: "credits",
  included,
  unlimited: false,
  reset: { interval: "month" },
  price: null,
  rollover: { max: rollover },
});

const features: AutumnFeature[] = [
  { id: "credits", name: "Credits", type: "metered", archived: false },
  { id: "extraction", name: "Data extraction", type: "boolean", archived: false },
];

const plans: AutumnPlan[] = [
  plan({
    id: "pro",
    price: { amount: 20, interval: "month" },
    metadata: { popular: true, highlights: "Priority support\nAll Go features" },
    items: [
      monthlyCredits(15_000, 15_000),
      { feature_id: "extraction", included: 0, unlimited: false, reset: null, price: null },
    ],
  }),
  plan({ id: "free", auto_enable: true }),
  plan({ id: "go", price: { amount: 5, interval: "month" }, items: [monthlyCredits(3_000, 3_000)] }),
  plan({ id: "team", price: { amount: 180, interval: "year" }, items: [monthlyCredits(20_000, 0)] }),
  plan({ id: "legacy", archived: true, price: { amount: 1, interval: "month" } }),
  plan({
    id: "signup_credits",
    group: null,
    add_on: true,
    items: [{ feature_id: "credits", included: 500, unlimited: false, reset: { interval: "one_off" }, price: null }],
  }),
  plan({
    id: "top_up",
    group: null,
    add_on: true,
    metadata: { bundles: "10000, 50000, 12345" },
    items: [
      {
        feature_id: "credits",
        included: 0,
        unlimited: false,
        reset: { interval: "one_off" },
        price: { amount: 1, interval: "one_off", billing_units: 10_000 },
      },
    ],
  }),
];

describe("the billing catalog", () => {
  const catalog = catalogFrom(plans, features);

  it("offers live main plans cheapest first, comparing yearly prices per month", () => {
    // Team is $180 a year, $15 a month: between Go and Pro. Archived plans are gone.
    expect(mainPlans(catalog).map((p) => p.id)).toEqual(["free", "go", "team", "pro"]);
  });

  it("reads credits, plan features and metadata set in the dashboard", () => {
    const pro = catalog.plans.find((p) => p.id === "pro")!;
    expect(pro.credits).toEqual({ included: 15_000, interval: "month", rolloverMax: 15_000 });
    expect(pro.features).toEqual(["extraction"]);
    expect(pro.popular).toBe(true);
    expect(pro.highlights).toEqual(["Priority support", "All Go features"]);
    expect(plansWithFeature(catalog, "extraction").map((p) => p.id)).toEqual(["pro"]);
  });

  it("caps plan credits at the refill plus rollover, or the signup credits without a refill", () => {
    expect(signupCredits(catalog)).toBe(500);
    expect(planCreditCap(catalog, "pro")).toBe(30_000);
    expect(planCreditCap(catalog, "free")).toBe(500);
  });

  it("offers top-up bundles in whole billing units, priced from the plan", () => {
    // 12,345 isn't a whole number of 10,000-credit units, so it's dropped.
    expect(topUpBundles(catalog)).toEqual([
      { credits: 10_000, amount: 1 },
      { credits: 50_000, amount: 5 },
    ]);
  });

  it("calls a move to a pricier plan or a longer billing interval an upgrade", () => {
    expect(isUpgrade(catalog, "go", "pro")).toBe(true);
    expect(isUpgrade(catalog, "pro", "go")).toBe(false);
    expect(isUpgrade(catalog, "free", "go")).toBe(true);
    // Team is cheaper per month than Pro, but Autumn charges a switch to
    // yearly billing at once.
    expect(isUpgrade(catalog, "pro", "team")).toBe(true);
    expect(isUpgrade(catalog, "team", "go")).toBe(false);
  });
});
