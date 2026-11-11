/**
 * The ids OpenScholar and Autumn agree on. Everything else about plans
 * (which exist, prices, credits, what they include) is set in Autumn's
 * dashboard and read from the synced catalog (convex/billing/catalog.ts).
 */

/** The metered feature every AI charge spends. */
export const CREDITS_FEATURE = "credits";

/** The plan a person starts on, which Autumn gives every new customer. */
export const FREE_PLAN = "free";

/** The plan for researchers in low- and middle-income countries, given by request (its `by_request` metadata in Autumn). */
export const SOUTHERN_PLAN = "southern";

/** Add-on attached once to every new customer, while Autumn's catalog has it. */
export const SIGNUP_PLAN = "signup_credits";

/** Add-on sold in bundles; its credits never expire. */
export const TOPUP_PLAN = "top_up";

/**
 * One-off add-on bought for each report activated past the workspace's free activations (#1261). Its price is the plan's
 * in Autumn; a promotion code on an Autumn reward lowers it.
 */
export const ACTIVATION_PLAN = "report_activation";

/** The plan an organization's customer starts on (#650): its own credits, shared by its members, and Free's limits. */
export const ORGANIZATION_PLAN = "free_organization";

/** An organization's paid plan (#652): its limits and features. Its price and credits are on its members' seats. */
export const TEAM_PLAN = "team";

/** Clerk's limit on a free organization's members, invitations included, while Team's seats are sold; Team has none. */
export const FREE_MEMBERS = 5;

/** People one request invites to an organization. */
export const INVITES_AT_ONCE = 10;

/**
 * Days after a renewal fails that Stripe stops retrying and cancels the plan (#40), measured on
 * the sandbox's settings: nine tries, cancelled 14 days after the first.
 * shortcut: Stripe's retry settings can't be read through its API; change this with them.
 * Counted from the invoice's creation, the only time Autumn gives: Stripe first tries about an hour
 * later, so the day shown can be one early near midnight, never late.
 */
export const DAYS_TO_PAY = 14;

/**
 * A Team member's seat (#652), attached to the member's entity on the organization's customer.
 * Each is billed on its own and adds its monthly credits to the organization's one pool.
 */
export const SEAT_PLAN = "team_seat";

/** The Autumn feature a member's entity is made for. */
export const SEATS_FEATURE = "seats";

/**
 * The boolean feature in Autumn that gives a workspace Evidence Libraries, and with them the
 * making and editing of author profiles (#652). Team has it; which plans do is set in Autumn's
 * dashboard, not here. A plan is one workspace's: it grants nothing in another. An organization
 * also has them when OpenScholar's admins switch them on for it (`opensLibraries`).
 */
export const EVIDENCE_LIBRARIES_FEATURE = "evidence_libraries";

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
 * - guests: people outside a workspace each of its items may be shared with, invitations still waiting included (#653).
 * - suggestions_per_day: sets of suggested searches written for a person on the home page in a day (#964); 0 turns them off.
 * - overviews_per_day: AI overviews of a search written free for a person in a day (#967); past it, and at 0, each one is asked for and paid in credits.
 * - reports_per_day: reports a workspace may start on Openscholar Reports in a day (#1261); each reserves a DOI and is read by AI.
 */
export const PLAN_LIMITS = ["collections", "concurrency", "assistant_replies", "request_papers", "bulk_papers", "uploads_per_hour", "guests", "suggestions_per_day", "overviews_per_day", "reports_per_day"] as const;
export type PlanLimit = (typeof PLAN_LIMITS)[number];
