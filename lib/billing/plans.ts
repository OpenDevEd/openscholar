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

/** The plan an organization's customer starts on (#650): its own credits, shared by its members, and Free's limits. */
export const ORGANIZATION_PLAN = "free_organization";

/** An organization's paid plan (#652): its limits and features. Its price and credits are on its members' seats. */
export const TEAM_PLAN = "team";

/**
 * A Team member's seat (#652), attached to the member's entity on the organization's customer.
 * Each is billed on its own and adds its monthly credits to the organization's one pool.
 */
export const SEAT_PLAN = "team_seat";

/** The Autumn feature a member's entity is made for. */
export const SEATS_FEATURE = "seats";

/** The plans only an organization is on; a person's own workspace never picks them. */
export const ORGANIZATION_PLANS: readonly string[] = [ORGANIZATION_PLAN, TEAM_PLAN, SEAT_PLAN];

/**
 * What a plan allows, each a metered feature in Autumn that is never used up: its amount on
 * the plan is the limit, and an unlimited one sets none (#632).
 * - collections: collections a person may have.
 * - concurrency: papers a person may have running at once in each pool (screening, extraction).
 * - assistant_replies: replies the assistant may be writing for a person at once.
 * - request_papers: papers one screening or extraction request may take.
 * - uploads_per_hour: files a person may attach to assistant chats in an hour (#647).
 */
export const PLAN_LIMITS = ["collections", "concurrency", "assistant_replies", "request_papers", "bulk_papers", "uploads_per_hour"] as const;
export type PlanLimit = (typeof PLAN_LIMITS)[number];
