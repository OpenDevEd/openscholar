import { atmn, feature, plan } from "atmn";
import { PAID_PLANS, SIGNUP_CREDITS, TOPUP } from "./lib/billing/plans";

// OpenScholar's billing catalog on the self-hosted Autumn.
// Push with: AUTUMN_BASE_URL=... AUTUMN_SECRET_KEY=... npx atmn push

export const credits = feature({
  internalId: "fe_3JwW8GDIl25AditaK6FLk6PcUDz",
  featureId: "credits",
  name: "Credits",
  type: "metered",
  consumable: true,
});

export const free = plan({
  internalId: "prod_3JwW8CaiWt2WgMjWbpMYYXAHGS9",
  planId: "free",
  versionSlug: "v1",
  active: true,
  name: "Free",
  group: "main",
  autoEnable: true,
  items: [],
});

export const signupCredits = plan({
  internalId: "prod_3JwW8Fg16wEMMAFjzb3is6zAhQi",
  planId: "signup_credits",
  versionSlug: "v1",
  active: true,
  name: "Signup credits",
  addOn: true,
  items: [{ featureId: credits.featureId, included: SIGNUP_CREDITS }],
});

export const go = plan({
  internalId: "prod_3JwW8DAuILxU06hOb1B7HHtnLy3",
  planId: "go",
  versionSlug: "v1",
  active: true,
  name: "Go",
  group: "main",
  price: { amount: PAID_PLANS.go.usdPerMonth, interval: "month" },
  items: [
    {
      featureId: credits.featureId,
      included: PAID_PLANS.go.creditsPerMonth,
      reset: { interval: "month" },
      rollover: {
        max: PAID_PLANS.go.creditsPerMonth,
        expiryDurationType: "forever",
        expiryDurationLength: 1,
      },
    },
  ],
});

export const pro = plan({
  internalId: "prod_3JwW8H8gf69ITtCsQkPe6gsAOcU",
  planId: "pro",
  versionSlug: "v1",
  active: true,
  name: "Pro",
  group: "main",
  price: { amount: PAID_PLANS.pro.usdPerMonth, interval: "month" },
  items: [
    {
      featureId: credits.featureId,
      included: PAID_PLANS.pro.creditsPerMonth,
      reset: { interval: "month" },
      rollover: {
        max: PAID_PLANS.pro.creditsPerMonth,
        expiryDurationType: "forever",
        expiryDurationLength: 1,
      },
    },
  ],
});

// Top-up credits never expire.
export const topUp = plan({
  internalId: "prod_3JwW8F5UjKpNJPgl7OnG0zSlmHQ",
  planId: "top_up",
  versionSlug: "v1",
  active: true,
  name: "Credit top-up",
  addOn: true,
  items: [
    {
      featureId: credits.featureId,
      price: {
        amount: TOPUP.usdPerUnit,
        billingUnits: TOPUP.creditsPerUnit,
        billingMethod: "prepaid",
        interval: "one_off",
      },
    },
  ],
});

export default atmn({
  features: [credits],
  plans: [free, signupCredits, go, pro, topUp],
});
