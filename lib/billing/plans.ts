/**
 * The ids OpenScholar and Autumn agree on. Everything else about plans
 * (which exist, prices, credits, what they include) is set in Autumn's
 * dashboard and read from the synced catalog (convex/billing/catalog.ts).
 */

/** The metered feature every AI charge spends. */
export const CREDITS_FEATURE = "credits";

/** Add-on attached once to every new customer. */
export const SIGNUP_PLAN = "signup_credits";

/** Add-on sold in bundles; its credits never expire. */
export const TOPUP_PLAN = "top_up";
