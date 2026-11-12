import { v } from "convex/values";
import { pick } from "convex-helpers";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../lib/functions";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { captureLater, UNNAMED_ACCOUNT } from "../lib/analyticsEvents";
import { getCurrentUser } from "../lib/auth";
import { actorIn } from "../workspaces/actor";
import { createError } from "../lib/errors";
import { autumn, type AutumnBalance, type AutumnCustomer } from "./autumn";
import {
  billingAccountFields,
  billingAccountSnapshotValidator,
  type BalancePart,
  type BillingAccountSnapshot,
} from "./validators";
import { PUBLICATION_FEATURE, EVIDENCE_LIBRARIES_FEATURE, REFILL_INTERVALS, type RefillInterval, ORGANIZATION_PLAN, PLAN_LIMITS, SIGNUP_PLAN, TOPUP_PLAN, type PlanLimit } from "../../lib/billing/plans";
import { readCatalog } from "./catalog";
import { defaultToSavedCard, stripeCredit } from "./stripeRest";

/** A person's own workspace, if they still have one: whose billing their own billing page shows. */
export const ownWorkspaceOf = async (ctx: Pick<QueryCtx, "db">, userId: Id<"users">) =>
  (await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique())?._id;

/**
 * The Autumn customer a workspace's plan and credits are on (#650): a person's own workspace
 * keeps theirs, the user's ID, so no customer moved; an organization's is its workspace's ID.
 */
export async function customerOf(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">): Promise<string> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) throw createError("NOT_FOUND", "Workspace not found");
  return workspace.kind === "personal" ? workspace.userId : workspace._id;
}

/** The workspace an Autumn customer is, for what Autumn and Stripe tell us about it; null for one that isn't ours. */
export async function workspaceOfCustomer(ctx: Pick<QueryCtx, "db">, customerId: string): Promise<Id<"workspaces"> | null> {
  const userId = ctx.db.normalizeId("users", customerId);
  if (userId) return (await ownWorkspaceOf(ctx, userId)) ?? null;
  const workspaceId = ctx.db.normalizeId("workspaces", customerId);
  return workspaceId && (await ctx.db.get("workspaces", workspaceId)) ? workspaceId : null;
}

/** The workspace's Autumn customer, for an action. */
export const customerFor = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.string(),
  handler: (ctx, { workspaceId }) => customerOf(ctx, workspaceId),
});

/** Which part of a balance a grant belongs to: the interval it refills by, or `once` for one that stays until used. */
const partOf = (interval: string | undefined): RefillInterval | "once" | null => (!interval || interval === "one_off" ? "once" : (REFILL_INTERVALS as readonly string[]).includes(interval) ? (interval as RefillInterval) : null);

/**
 * A balance's grants by part, as Autumn spends them: those that refill, shortest interval first, then those that stay
 * until used. Each part sums its grants. What stays, all spent, is left out: there is nothing to say of it.
 */
export function partsOf(balance: AutumnBalance | undefined): { publication?: BalancePart[]; publicationUnlimited?: true } {
  if (!balance) return {};
  if (balance.unlimited) return { publicationUnlimited: true };
  // ponytail: the interval alone, not its count, so a grant every two weeks reads as weekly. Autumn's `interval_count` says when it matters.
  const parts = ([...REFILL_INTERVALS, "once"] as const).flatMap((interval): BalancePart[] => {
    const of = (balance.breakdown ?? []).filter((grant) => partOf(grant.reset?.interval) === interval);
    const left = of.reduce((sum, grant) => sum + grant.remaining, 0);
    if (of.length === 0 || (interval === "once" && left <= 0)) return [];
    const sizeOf = (grant: (typeof of)[number]) => (grant.included_grant ?? 0) + (grant.prepaid_grant ?? 0);
    const size = of.reduce((sum, grant) => sum + sizeOf(grant), 0);
    const resets = of.flatMap((grant) => (grant.reset?.resets_at ? [grant.reset.resets_at] : []));
    if (resets.length === 0) return [{ interval, left, size }];
    // Grants of one interval can refill on different days: at the next one, only those come back to full.
    const resetsAt = Math.min(...resets);
    const refillsTo = of.reduce((sum, grant) => sum + (grant.reset?.resets_at === resetsAt ? sizeOf(grant) : grant.remaining), 0);
    return [{ interval, left, size, resetsAt, refillsTo }];
  });
  return parts.length > 0 ? { publication: parts } : {};
}

/** The workspace's publication balance as its cached account has it: its parts, and what it holds in US dollars (null for no limit). */
export function publicationOf(account: { publication?: BalancePart[]; publicationUnlimited?: boolean } | null) {
  const parts = account?.publication ?? [];
  return { parts, balance: account?.publicationUnlimited ? null : parts.reduce((sum, part) => sum + part.left, 0) };
}

/** Reads what OpenScholar needs from an Autumn customer. */
export function snapshotFromCustomer(customer: AutumnCustomer): BillingAccountSnapshot {
  const main = customer.subscriptions.filter((s) => !s.add_on);
  const current = main.find((s) => s.status === "active" || s.status === "trialing");
  const scheduled = main.find((s) => s.status === "scheduled");
  // The plan Autumn gives every customer (Free) is auto-enabled; any other
  // main plan was chosen and is paid for.
  const onPaidPlan = Boolean(current && !current.auto_enable);
  const periodEnd = current?.current_period_end ?? undefined;
  // The payment that failed, while the plan is past due (#40): the oldest of its plan's invoices still open, whose failure started
  // Stripe's retries. A top-up or another plan's change declined meanwhile has an open invoice too, which Autumn voids within minutes.
  const unpaid = current?.past_due
    ? (customer.invoices ?? []).filter((invoice) => invoice.status === "open" && invoice.plan_ids?.includes(current.plan_id)).sort((a, b) => a.created_at - b.created_at)[0]
    : undefined;
  return {
    ...(current ? { plan: current.plan_id } : {}),
    pastDue: current?.past_due ?? false,
    periodStart: onPaidPlan ? (current?.current_period_start ?? undefined) : undefined,
    // A plan that bills renews with its period; a free one's credits come back when Autumn resets them.
    renewsAt: current?.canceled_at ? undefined : ((onPaidPlan ? periodEnd : undefined) ?? customer.balances.credits?.next_reset_at ?? undefined),
    changesAt: current?.canceled_at ? periodEnd : undefined,
    nextPlan: scheduled?.plan_id,
    features: Object.keys(customer.flags ?? {}),
    balance: customer.balances.credits?.remaining ?? 0,
    // A limit is never used up, so what the plans grant is the limit itself.
    limits: Object.fromEntries(PLAN_LIMITS.flatMap((limit) => {
      const balance = customer.balances[limit];
      return balance ? [[limit, balance.unlimited ? null : (balance.granted ?? balance.remaining)]] : [];
    })),
    purchased: (customer.balances.credits?.breakdown ?? [])
      .filter((balance) => balance.plan_id === TOPUP_PLAN)
      .reduce((sum, balance) => sum + balance.remaining, 0),
    ...partsOf(customer.balances[PUBLICATION_FEATURE]),
    card: customer.payment_method?.card
      ? { brand: customer.payment_method.card.brand, last4: customer.payment_method.card.last4 }
      : undefined,
    signupGranted: customer.subscriptions.some((s) => s.plan_id === SIGNUP_PLAN),
    hasPaid: onPaidPlan || (customer.purchases ?? []).length > 0,
    paying: (onPaidPlan && current?.plan_id !== ORGANIZATION_PLAN && current?.status !== "trialing") || (customer.purchases ?? []).length > 0,
    stripeCustomerId: customer.stripe_id ?? undefined,
    ...(unpaid ? { unpaid: { amount: unpaid.total, currency: unpaid.currency, since: unpaid.created_at, ...(unpaid.hosted_invoice_url ? { url: unpaid.hosted_invoice_url } : {}) } } : {}),
  };
}

/** The workspace's cached account: its Autumn customer's plan, features and balance (#650). */
export async function readAccount(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">) {
  return await ctx.db
    .query("billingAccounts")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
}

/** The workspace's cached balance, for preflight checks. Locks enforce the real limit. */
export async function availableCredits(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">) {
  return (await readAccount(ctx, workspaceId))?.balance ?? 0;
}

/**
 * What the workspace's plan allows of `limit` (#632; the workspace's since #650), or
 * undefined when it sets none. Its cached snapshot says, unless its plan's version predates
 * the limit or nothing is cached yet: then its plan in the synced catalog does, or, with no
 * plan, the plan a new customer of its kind starts on. A plan the catalog no longer lists
 * sets none.
 */
export async function planLimit(ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">, limit: PlanLimit): Promise<number | undefined> {
  const account = await readAccount(ctx, workspaceId);
  const own = account?.limits?.[limit];
  if (own !== undefined) return own ?? undefined;
  const plans = (await readCatalog(ctx))?.plans ?? [];
  const organization = (await ctx.db.get("workspaces", workspaceId))?.kind === "organization";
  const plan = account?.plan
    ? plans.find((candidate) => candidate.id === account.plan)
    : plans.find((candidate) => (organization ? candidate.id === ORGANIZATION_PLAN : candidate.autoEnable && !candidate.addOn));
  return plan?.limits?.[limit] ?? undefined;
}

/** Refuses a request for more papers than the workspace's plan takes in one (#632). */
export async function checkRequestPapers(ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">, papers: number, what: "screening" | "extraction") {
  const most = await planLimit(ctx, workspaceId, "request_papers");
  if (most !== undefined && papers > most) {
    throw createError("VALIDATION_ERROR", `Your plan takes up to ${most.toLocaleString("en")} papers in one ${what}. Pick fewer.`);
  }
}

/** Whether the workspace's plans grant `featureId`, per the cached snapshot. */
export async function hasPlanFeature(
  ctx: Pick<QueryCtx, "db">,
  workspaceId: Id<"workspaces">,
  featureId: string,
): Promise<boolean> {
  return (await readAccount(ctx, workspaceId))?.features?.includes(featureId) ?? false;
}

/**
 * Whether Evidence Communities, and author profiles with them, can be created in the workspace: its plan
 * grants them, or OpenScholar's admins switched them on for it, a person's own workspace or an organization.
 * Only creating asks: everything else about a community follows the person's role on it.
 */
export async function opensLibraries(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">): Promise<boolean> {
  if (await hasPlanFeature(ctx, workspaceId, EVIDENCE_LIBRARIES_FEATURE)) return true;
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (workspace?.kind === "personal") return workspace.evidenceLibraries === true;
  return workspace?.kind === "organization" && (await ctx.db.get("organizations", workspace.organizationId))?.evidenceLibraries === true;
}

/** Whether the Team plan and its seats are on sale. Off, an organization has no member limit and every one has member caps. */
export async function seatBillingOn(ctx: Pick<QueryCtx, "db">): Promise<boolean> {
  return (await ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", "subscriptions.team")).unique())?.enabled === true;
}

/**
 * Stores a snapshot read from Autumn at `fetchedAt`. `withCard` says its card
 * was fetched; without it the cached card stays. A balance the cache learned
 * after `fetchedAt` (a charge that emptied it) stays too.
 */
export const writeSnapshot = internalMutation({
  args: { workspaceId: v.id("workspaces"), snapshot: billingAccountSnapshotValidator, withCard: v.boolean(), fetchedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { workspaceId, snapshot, withCard, fetchedAt }) => {
    const existing = await readAccount(ctx, workspaceId);
    const workspace = await ctx.db.get("workspaces", workspaceId);
    if (!workspace) return null;
    // A snapshot read before the one cached would bring back an older plan and its limits. Its card can still be the newest read.
    if (existing?.fetchedAt !== undefined && existing.fetchedAt > fetchedAt) {
      if (withCard && (existing.cardFetchedAt ?? 0) < fetchedAt) await ctx.db.patch("billingAccounts", existing._id, { card: snapshot.card, credit: snapshot.credit, cardFetchedAt: fetchedAt });
      return null;
    }
    const newer = existing !== null && existing.refreshedAt > fetchedAt;
    // A report being paid for buys into the publication balance and spends it in two steps at Autumn. A read between
    // them would show the balance up, then back down: while one is under way the balance stays as it was last read,
    // and the activation reads it again when it is done.
    const paying = existing !== null && (await payingForReport(ctx, workspaceId));
    const row = {
      ...snapshot,
      ...(paying && { publication: existing.publication, publicationUnlimited: existing.publicationUnlimited }),
      ...(withCard ? { card: snapshot.card, credit: snapshot.credit, cardFetchedAt: fetchedAt } : { card: existing?.card, credit: existing?.credit, cardFetchedAt: existing?.cardFetchedAt }),
      ...(newer && { balance: existing.balance, purchased: existing.purchased }),
      workspaceId,
      firstPaidAt: existing?.firstPaidAt ?? (snapshot.paying ? fetchedAt : undefined),
      refreshedAt: newer ? existing.refreshedAt : fetchedAt,
      fetchedAt,
    };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("billingAccounts", row);
    await captureBillingChanges(ctx, workspace, existing, snapshot, fetchedAt);
    return null;
  },
});

/** How long a report's charge can be under way: its hold at Autumn lasts as long (reports/activation.ts `HOLD_MS`). One older was left by an action that died. */
const CHARGING_MS = 5 * 60_000;

/** Whether a report of the workspace is being paid for now: its charge is under way, or waits on the bank or on Stripe's page. */
async function payingForReport(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const state = (state: "charging" | "pending") => ctx.db.query("reportActivations").withIndex("by_workspaceId_and_state", (q) => q.eq("workspaceId", workspaceId).eq("state", state)).order("desc").first();
  const charging = await state("charging");
  return (charging !== null && charging.at > Date.now() - CHARGING_MS) || (await state("pending")) !== null;
}

/**
 * Zeroes the cached balance now, so work that only checks the cache stops: a
 * charge reported the balance empty, or couldn't reach Autumn. The queued
 * refresh restores the real balance.
 */
export async function zeroCachedBalance(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const account = await readAccount(ctx, workspaceId);
  if (account && account.balance > 0) {
    await ctx.db.patch("billingAccounts", account._id, { balance: 0, purchased: 0, refreshedAt: Date.now() });
  }
  await requestRefresh(ctx, workspaceId);
}

export const zeroBalance = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    await zeroCachedBalance(ctx, workspaceId);
    return null;
  },
});

/** A first payment and a change of plan, read from what Autumn just said: every way of paying ends up here. */
async function captureBillingChanges(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
  before: Doc<"billingAccounts"> | null,
  after: BillingAccountSnapshot,
  timestamp: number,
) {
  if (!before) return;
  const person = workspace.kind === "personal" ? await ctx.db.get("users", workspace.userId) : null;
  const shared = { distinctId: person?.clerkId ?? UNNAMED_ACCOUNT, timestamp };
  const workspaceKind = { workspace_kind: workspace.kind };
  await captureLater(ctx, [
    // A row cached before `paying` existed says so through `hasPaid`, so someone who already paid isn't counted as new.
    ...(after.paying && !(before.paying ?? before.hasPaid) && before.firstPaidAt === undefined ? [{ ...shared, event: "first_payment", properties: { ...workspaceKind, plan: after.plan } }] : []),
    ...(before.plan && after.plan && before.plan !== after.plan
      ? [{ ...shared, event: "plan_changed", properties: { ...workspaceKind, from_plan: before.plan, to_plan: after.plan } }]
      : []),
  ]);
}

/**
 * Fetches the customer from Autumn and stores the snapshot. The card costs
 * Autumn a call to Stripe, so only billing screens and card events ask for it.
 */
export async function refreshAccount(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
  options: { email?: string; name?: string; card?: boolean; savedIn?: string } = {},
): Promise<BillingAccountSnapshot> {
  const fetchedAt = Date.now();
  const customerId: string = await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId });
  let customer = await autumn.customer(customerId, options);
  // Back from saving a card on Stripe's page (its Checkout session, `savedIn`): that card is the one charged from now on.
  if (options.savedIn && customer.stripe_id) {
    await defaultToSavedCard(customer.stripe_id, options.savedIn);
    customer = await autumn.customer(customerId, options);
  }
  // A failed payment's invoice is read only while one is due, which is rare.
  if (customer.subscriptions.some((subscription) => subscription.past_due)) customer = await autumn.customer(customerId, { ...options, invoices: true });
  // The card's read also reads the credit on the Stripe balance, which a purchase is paid from first.
  const credit = options.card && customer.stripe_id ? await stripeCredit(customer.stripe_id) : undefined;
  const snapshot = { ...snapshotFromCustomer(customer), ...(credit !== undefined && { credit }) };
  await ctx.runMutation(internal.billing.accounts.writeSnapshot, { workspaceId, snapshot, withCard: options.card ?? false, fetchedAt });
  return snapshot;
}

/** How long charges wait before the account re-reads Autumn, so a burst of them reads it once. */
const REFRESH_DELAY_MS = 3_000;
/** A queued refresh older than this failed; the next charge queues another. */
const REFRESH_STUCK_MS = 60_000;

/**
 * Re-reads the account from Autumn shortly, unless a re-read is already
 * queued. Charges call it instead of reading Autumn themselves, so parallel
 * work doesn't write the account row once per charge.
 */
export async function requestRefresh(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const account = await readAccount(ctx, workspaceId);
  if (account?.refreshQueuedAt && Date.now() - account.refreshQueuedAt < REFRESH_STUCK_MS) return;
  if (account) await ctx.db.patch("billingAccounts", account._id, { refreshQueuedAt: Date.now() });
  await ctx.scheduler.runAfter(REFRESH_DELAY_MS, internal.billing.accounts.refresh, { workspaceId });
}

export const refresh = internalAction({
  // `userId` alone: a refresh scheduled before accounts were a workspace's (#650), which is the person's own; slice 8 drops it.
  args: { workspaceId: v.optional(v.id("workspaces")), userId: v.optional(v.id("users")), card: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { workspaceId, userId, card }) => {
    const refreshed = workspaceId ?? (userId ? await ctx.runQuery(internal.workspaces.actor.personalOf, { userId }) : null);
    if (refreshed) await refreshAccount(ctx, refreshed, { card: card ?? false });
    return null;
  },
});

/**
 * Creates the Autumn customer and grants the one-time signup credits.
 * Scheduled once when the user row is created; safe to run again.
 */
export const provision = internalAction({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user) return null;
    const workspaceId: Id<"workspaces"> = await ctx.runQuery(internal.workspaces.actor.personalOf, { userId });
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;
    const snapshot = await refreshAccount(ctx, workspaceId, { email: user.email, name });
    // Which plans exist is Autumn's to say: signup credits are given while its catalog has them.
    const catalog = await ctx.runQuery(api.billing.catalog.get, {});
    if (!snapshot.signupGranted && (!catalog || catalog.plans.some((plan) => plan.id === SIGNUP_PLAN))) {
      await autumn.attach({
        customerId: userId,
        planId: SIGNUP_PLAN,
        idempotencyKey: `signup-${userId}`,
      });
      await refreshAccount(ctx, workspaceId);
    }
    return null;
  },
});

/**
 * Creates an organization's Autumn customer, its workspace's ID, on the free organization
 * plan (#650): its own credits and limits from the start. Safe to run again.
 */
export const provisionOrganization = internalAction({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    const organization = await ctx.runQuery(internal.billing.accounts.organizationOf, { workspaceId });
    if (!organization) return null;
    const snapshot = await refreshAccount(ctx, workspaceId, { name: organization.name });
    // Autumn gives every new customer the personal Free plan; the organization plan, in its group, takes its place.
    // One that has paid for a plan of its own keeps it.
    if (snapshot.plan !== ORGANIZATION_PLAN && !snapshot.hasPaid) {
      await autumn.attach({ customerId: workspaceId, planId: ORGANIZATION_PLAN, idempotencyKey: `organization-${workspaceId}` });
      await refreshAccount(ctx, workspaceId);
    }
    return null;
  },
});

/** The organization a workspace is, if it's one. */
export const organizationOf = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.object({ name: v.string(), slug: v.string() }), v.null()),
  handler: async (ctx, { workspaceId }) => {
    const workspace = await ctx.db.get("workspaces", workspaceId);
    const organization = workspace?.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null;
    return organization ? { name: organization.name, slug: organization.slug } : null;
  },
});

/** How old a cached account may be before opening billing re-reads it. */
const REFRESH_AFTER_MS = 30_000;

/**
 * Re-reads the signed-in user's account from Autumn, or in `workspaceId` its organization's.
 * The billing page calls it while rendering on the server, so edits made in Autumn's dashboard
 * that send no webhook (a balance grant, say) show when the page opens, as Pricing does when an
 * admin comes back from saving the organization's card (#652).
 */
export const refreshMine = action({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  returns: v.null(),
  handler: async (ctx, { workspaceId: given }) => {
    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) return null;
    const workspaceId: Id<"workspaces"> = given ? (await ctx.runQuery(internal.workspaces.actor.signedInActor, { workspaceId: given })).workspaceId : await ctx.runQuery(internal.workspaces.actor.personalOf, { userId: user._id });
    const account = await ctx.runQuery(internal.billing.accounts.forWorkspace, { workspaceId });
    if (account && Date.now() - account.refreshedAt < REFRESH_AFTER_MS) return null;
    await refreshAccount(ctx, workspaceId, { card: true });
    return null;
  },
});

/** What the workspace's plan allows of `limit`, for an action: a number, or null for none. */
export const planLimitOf = internalQuery({
  args: { workspaceId: v.id("workspaces"), limit: v.union(...PLAN_LIMITS.map((limit) => v.literal(limit))) },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { workspaceId, limit }) => (await planLimit(ctx, workspaceId, limit)) ?? null,
});

export const forWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.object(billingAccountFields), v.null()),
  handler: async (ctx, { workspaceId }) => {
    const row = await readAccount(ctx, workspaceId);
    if (!row) return null;
    const { _id, _creationTime, ...fields } = row;
    return fields;
  },
});

const { stripeCustomerId: _stripeCustomerId, ...myAccountFields } =
  billingAccountSnapshotValidator.fields;
const myAccountKeys = Object.keys(myAccountFields) as (keyof typeof myAccountFields)[];

/**
 * The workspace a page reads its plan and credits for (#651): `workspaceId` when the person acts
 * in it, their own when it's left out (a page outside /o/<slug>, or one rendered on the server).
 */
async function pageWorkspace(ctx: QueryCtx, workspaceId: Id<"workspaces"> | undefined) {
  return (await pageActor(ctx, workspaceId))?.workspaceId;
}

/** The person reading a page and their role in its workspace: their own, where they're its admin, when it names none. */
async function pageActor(ctx: QueryCtx, workspaceId: Id<"workspaces"> | undefined) {
  const user = await getCurrentUser(ctx);
  if (!user) return undefined;
  if (!workspaceId) return { workspaceId: await ownWorkspaceOf(ctx, user._id), role: "admin" as const };
  return (await actorIn(ctx, user, workspaceId)) ?? undefined;
}

export const mine = query({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  returns: v.union(v.object(myAccountFields), v.null()),
  handler: async (ctx, args) => {
    const actor = await pageActor(ctx, args.workspaceId);
    if (!actor?.workspaceId) return null;
    const row = await readAccount(ctx, actor.workspaceId);
    if (!row) return null;
    // Copy only the fields the validator declares, so internal columns stay private.
    const account = pick(row, myAccountKeys);
    // The page that pays a failed invoice is the payer's own: an organization's members see that it failed, not where to pay (#40).
    if (account.unpaid && actor.role !== "admin") account.unpaid = { amount: account.unpaid.amount, currency: account.unpaid.currency, since: account.unpaid.since };
    return account;
  },
});

/** What the signed-in person's plan allows of each limit (#632): a number, or null for none. Null when signed out. */
export const myLimits = query({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  returns: v.union(v.object({ collections: v.union(v.number(), v.null()), concurrency: v.union(v.number(), v.null()), assistant_replies: v.union(v.number(), v.null()), request_papers: v.union(v.number(), v.null()), guests: v.union(v.number(), v.null()) }), v.null()),
  handler: async (ctx, args) => {
    const workspaceId = await pageWorkspace(ctx, args.workspaceId);
    if (!workspaceId) return null;
    const limit = async (name: PlanLimit) => (await planLimit(ctx, workspaceId, name)) ?? null;
    return { collections: await limit("collections"), concurrency: await limit("concurrency"), assistant_replies: await limit("assistant_replies"), request_papers: await limit("request_papers"), guests: await limit("guests") };
  },
});

/** Preflight for dialogs that start paid work. Locks enforce the real limit. */
export const checkBalance = query({
  // The page's workspace, whose credits pay (#651); none, the person's own.
  args: { requiredAmount: v.number(), workspaceId: v.optional(v.id("workspaces")) },
  returns: v.union(
    v.object({
      hasEnough: v.boolean(),
      free: v.number(),
      paid: v.number(),
      total: v.number(),
      required: v.number(),
      deficit: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { requiredAmount, workspaceId: named }) => {
    const workspaceId = await pageWorkspace(ctx, named);
    if (!workspaceId) return null;
    const account = await readAccount(ctx, workspaceId);
    const total = account?.balance ?? 0;
    const paid = account?.purchased ?? 0;
    return {
      hasEnough: total >= requiredAmount,
      free: total - paid,
      paid,
      total,
      required: requiredAmount,
      deficit: Math.max(0, requiredAmount - total),
    };
  },
});
