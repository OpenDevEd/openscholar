/**
 * Team seats are bought (#862) and filled by members (#863), on Autumn's Licenses: the Team plan
 * holds a count of seats, paid for together, and each active member is given one of them as an
 * Autumn entity named by their Clerk user ID, which their charges are made as and which carries
 * their cap. Members, pending invitations and held seats can't outnumber the seats: Clerk's limit
 * on the organization's members is the seats that are free of held ones, and it counts invitations.
 *
 * A member who leaves frees their seat, unless they spent credits this billing period: then it
 * stays theirs until the renewal (Cursor's rule), since a seat released in Autumn can hand what was
 * spent from it back to the pool. An organization off Team holds no seats and no entities, and is
 * on the free organization plan; one that's gone has nothing of Team.
 *
 * `sync` brings Autumn to that from what Convex holds, so running it again changes nothing: it
 * runs on each membership change, on each Autumn event for the organization, when it's deleted,
 * and daily for every organization on Team, still holding seats, or gone with something of Team
 * not yet ended. One runs at a time for an organization; one asked for meanwhile runs once more
 * after it.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { internalAction, internalMutation, internalQuery, query, type ActionCtx, type QueryCtx } from "../lib/functions";
import { getCurrentUser } from "../lib/auth";
import { actorIn } from "../workspaces/actor";
import { personName } from "../lib/people";
import { MAX_ORGANIZATION_MEMBERS } from "../lib/queryBounds";
import { FREE_MEMBERS, ORGANIZATION_PLAN, SEAT_PLAN, SEATS_FEATURE, TEAM_PLAN } from "../../lib/billing/plans";
import { monthStart } from "../../lib/billing/month";
import { clerkRequest, clerkSecretKey } from "../lib/clerk";
import { createError } from "../lib/errors";
import { readAccount, refreshAccount, snapshotFromCustomer } from "./accounts";
import { seatSyncRow } from "./seatSyncs";
import { capRow, spentSince } from "./memberCaps";
import { autumn, AutumnError, type AutumnEntity } from "./autumn";

/** A member as a seat is given to them: the cap an admin set on them goes on their entity. */
export type SeatMember = { clerkUserId: string; name: string; cap?: number };

/** Entities read from Autumn in one call. */
const ENTITIES_PAGE = 100;

/**
 * Most entities one sync reads: one for every member, with room for those of members who left
 * that are still to go. Past it the customer isn't one sync's to fix; it says so.
 */
const MAX_ENTITIES_READ = 2 * MAX_ORGANIZATION_MEMBERS;

/** The organization's active members, each with their cap, or null when it has more than one read takes: then no seat changes. */
export const membersOf = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.array(v.object({ clerkUserId: v.string(), name: v.string(), cap: v.optional(v.number()) })), v.null()),
  handler: async (ctx, { workspaceId }) => {
    const workspace = await ctx.db.get("workspaces", workspaceId);
    if (workspace?.kind !== "organization") return [];
    const memberships = await ctx.db
      .query("organizationMemberships")
      .withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", workspace.organizationId).eq("state", "active"))
      .take(MAX_ORGANIZATION_MEMBERS + 1);
    if (memberships.length > MAX_ORGANIZATION_MEMBERS) return null;
    return await Promise.all(
      memberships.map(async ({ clerkUserId }) => {
        const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique();
        const cap = user ? (await capRow(ctx, workspaceId, user._id))?.cap : undefined;
        return { clerkUserId, name: (user && (personName(user) || user.email)) || clerkUserId, ...(cap === undefined ? {} : { cap }) };
      }),
    );
  },
});

/** The start of the organization's billing period: its Team's, or the calendar month's when Autumn gives none. */
const periodStartOf = (account: { periodStart?: number } | undefined, now: number) => account?.periodStart ?? monthStart(now);

/** Of `clerkUserIds`, the people who spent the organization's credits since `since`: their seats stay theirs until the renewal. */
export const spentFrom = internalQuery({
  args: { workspaceId: v.id("workspaces"), clerkUserIds: v.array(v.string()), since: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, { workspaceId, clerkUserIds, since }) => {
    const spent: string[] = [];
    for (const clerkUserId of clerkUserIds.slice(0, MAX_ORGANIZATION_MEMBERS)) {
      const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique();
      if (user && (await spentSince(ctx, workspaceId, user._id, since)) > 0) spent.push(clerkUserId);
    }
    return spent;
  },
});

/** The organization a workspace is, for its sync: its Clerk ID and the member limit last set on it, or null once it's gone. */
export const organizationFor = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.object({ clerkOrganizationId: v.string(), memberLimit: v.optional(v.number()) }), v.null()),
  handler: async (ctx, { workspaceId }) => {
    const workspace = await ctx.db.get("workspaces", workspaceId);
    const organization = workspace?.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null;
    if (organization?.state !== "active") return null;
    const memberLimit = (await seatSyncRow(ctx, workspaceId))?.memberLimit;
    return { clerkOrganizationId: organization.clerkOrganizationId, ...(memberLimit === undefined ? {} : { memberLimit }) };
  },
});

/** Marks an organization whose Team is ending, for the daily check to sync until nothing of it is left. */
export const markEnding = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    const row = await seatSyncRow(ctx, workspaceId);
    if (row) await ctx.db.patch("seatSyncs", row._id, { ending: true });
    return null;
  },
});

/** Keeps the member limit a sync set on the organization in Clerk. */
export const noteMemberLimit = internalMutation({
  args: { workspaceId: v.id("workspaces"), memberLimit: v.number() },
  returns: v.null(),
  handler: async (ctx, { workspaceId, memberLimit }) => {
    const row = await seatSyncRow(ctx, workspaceId);
    if (row) await ctx.db.patch("seatSyncs", row._id, { memberLimit });
    return null;
  },
});

/** Runs an Autumn call whose `code` failure means it's already done, such as deleting an entity that's gone. */
async function unlessAlready<T>(code: string, call: () => Promise<T>): Promise<T | undefined> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof AutumnError && error.code === code)) throw error;
    return undefined;
  }
}

/** The customer's entities, or null when it has more than MAX_ENTITIES_READ. */
async function entitiesOf(customerId: string) {
  const entities: AutumnEntity[] = [];
  for (let cursor: string | null = null; ;) {
    const page: { list: AutumnEntity[]; next_cursor: string | null } = await autumn.listEntities(customerId, cursor, ENTITIES_PAGE);
    entities.push(...page.list);
    if (entities.length > MAX_ENTITIES_READ) return null;
    if (!page.next_cursor) return entities;
    cursor = page.next_cursor;
  }
}

/** The seats bought on the customer's Team, and how many are left to give out. */
async function seatPool(customerId: string) {
  const pool = (await autumn.seatPools(customerId)).list.find((p) => p.license_plan_id === SEAT_PLAN);
  return { seats: pool?.granted ?? 0, remaining: pool?.remaining ?? 0 };
}

/** What a sync leaves: the seats bought, how many of them are held by members who left, and whether nothing of Team is left. */
type Synced = { seats: number; held: number; ended?: true };

/** Brings the organization's seats to its members; undefined when it changed nothing. */
async function syncSeats(ctx: ActionCtx, workspaceId: Id<"workspaces">): Promise<Synced | undefined> {
  const organization: { clerkOrganizationId: string; memberLimit?: number } | null = await ctx.runQuery(internal.billing.seats.organizationFor, { workspaceId });
  // One that's gone keeps no account here, and its workspace may be purged; its customer is still its workspace's ID.
  const account = organization ? await refreshAccount(ctx, workspaceId) : undefined;
  const customerId: string = organization ? await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId }) : workspaceId;
  const team = account?.plan === TEAM_PLAN;
  const members: SeatMember[] | null = team ? await ctx.runQuery(internal.billing.seats.membersOf, { workspaceId }) : [];
  if (members === null) {
    console.error(`[seats] ${workspaceId} has more than ${MAX_ORGANIZATION_MEMBERS} members; its seats are left as they are`);
    return undefined;
  }
  const memberIds = new Set(members.map((member) => member.clerkUserId));
  const holders = new Set((await autumn.seatHolders(customerId)).list.filter((holder) => holder.license_plan_id === SEAT_PLAN).map((holder) => holder.entity_id));
  const left = [...holders].filter((id) => !memberIds.has(id));
  // On Team, a seat its member spent from this period stays theirs until the renewal; off it, Autumn has ended them all.
  const held: string[] = team && left.length ? await ctx.runQuery(internal.billing.seats.spentFrom, { workspaceId, clerkUserIds: left, since: periodStartOf(account, Date.now()) }) : [];
  const freed = left.filter((id) => !held.includes(id));
  if (freed.length) await autumn.releaseSeats(customerId, SEAT_PLAN, freed);
  // Everyone else's entity goes, with the cap on it: a member who comes back is given a new one.
  const entities = await entitiesOf(customerId);
  if (entities === null) {
    console.error(`[seats] ${workspaceId}'s customer has more than ${MAX_ENTITIES_READ} entities; they're left as they are`);
    return undefined;
  }
  const gone = entities.filter((entity) => !memberIds.has(entity.id) && !held.includes(entity.id)).map((entity) => entity.id);
  for (const entityId of gone) await unlessAlready("entity_not_found", () => autumn.deleteEntity(customerId, entityId));

  const pool = team ? await seatPool(customerId) : { seats: 0, remaining: 0 };
  const waiting = members.filter((member) => !holders.has(member.clerkUserId));
  // Members and invitations can't outnumber the seats, so there's room for everyone who joined; past it, someone joined in a race and waits for a seat.
  const seating = waiting.slice(0, pool.remaining);
  if (seating.length) await autumn.assignSeats({ customerId, licensePlanId: SEAT_PLAN, featureId: SEATS_FEATURE, members: seating.map((member) => ({ entityId: member.clerkUserId, name: member.name })) });
  for (const member of seating) if (member.cap !== undefined) await autumn.setCap(customerId, member.clerkUserId, member.cap);
  if (waiting.length > seating.length) console.error(`[seats] ${workspaceId} has ${waiting.length - seating.length} members without a seat: none is left`);
  // Charges are made as a member's entity once they hold a seat, and no longer once they've left.
  const unseated = new Set(waiting.slice(seating.length).map((member) => member.clerkUserId));
  await ctx.runMutation(internal.billing.seats.recordSeats, { workspaceId, seated: members.flatMap((member) => (unseated.has(member.clerkUserId) ? [] : [member.clerkUserId])) });
  if (seating.length || freed.length || gone.length) {
    if (organization) await refreshAccount(ctx, workspaceId);
    console.log(`[seats] ${workspaceId} ${organization ? `on ${account?.plan}` : "is gone"}: ${members.length} members, ${pool.seats} seats; seated ${seating.length}, freed ${freed.length}, held ${held.length}, entities removed ${gone.length}`);
  }
  if (organization) {
    // Off Team, it's on the free organization plan, unless a move there is waiting for the renewal.
    if (!team && account?.plan !== ORGANIZATION_PLAN && account?.changesAt === undefined) {
      await autumn.attach({ customerId, planId: ORGANIZATION_PLAN });
      await refreshAccount(ctx, workspaceId);
    }
    await followPlan(ctx, workspaceId, organization, team ? pool.seats - held.length : FREE_MEMBERS);
    return { seats: pool.seats, held: held.length, ...(team ? {} : { ended: true as const }) };
  }
  // An organization that's gone has its Team plan cancelled too, and then nothing of it is left to end (#652).
  if (snapshotFromCustomer(await autumn.customer(customerId)).plan === TEAM_PLAN) await autumn.update({ customerId, planId: TEAM_PLAN, cancelAction: "cancel_immediately" });
  return { seats: 0, held: 0, ended: true };
}

/** How long a sync waits before trying again to set a member limit Clerk refused. */
const LIMIT_RETRY_MS = 10 * 60_000;

/**
 * Sets Clerk's limit on the organization's members, which counts its pending invitations too: the
 * seats free of held ones on Team (#863), FREE_MEMBERS otherwise.
 */
async function followPlan(ctx: ActionCtx, workspaceId: Id<"workspaces">, { clerkOrganizationId, memberLimit }: { clerkOrganizationId: string; memberLimit?: number }, wanted: number) {
  const limit = Math.max(1, wanted);
  if (memberLimit === limit) return;
  try {
    await clerkRequest(clerkSecretKey(), "PATCH", `/organizations/${clerkOrganizationId}`, { max_allowed_memberships: limit });
    await ctx.runMutation(internal.billing.seats.noteMemberLimit, { workspaceId, memberLimit: limit });
  } catch (error) {
    // The seats it changed stand. A free organization may not sync again by itself, so this one does, a little later.
    console.error(`[seats] couldn't set ${workspaceId}'s member limit to ${limit} in Clerk; trying again in ${LIMIT_RETRY_MS / 60_000} minutes`, error);
    await ctx.scheduler.runAfter(LIMIT_RETRY_MS, internal.billing.seats.sync, { workspaceId });
  }
}

/** Sets Clerk's limit on the organization's members to Free's ahead of its plan: a move to Free holds it there from when it's asked for. */
export const limitToFree = internalAction({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }): Promise<null> => {
    const organization: { clerkOrganizationId: string; memberLimit?: number } | null = await ctx.runQuery(internal.billing.seats.organizationFor, { workspaceId });
    if (organization) await followPlan(ctx, workspaceId, organization, FREE_MEMBERS);
    return null;
  },
});

/** Keeps which members hold a seat (`memberSeats`): exactly `seated`, at most MAX_ORGANIZATION_MEMBERS. */
export const recordSeats = internalMutation({
  args: { workspaceId: v.id("workspaces"), seated: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { workspaceId, seated }) => {
    if (seated.length > MAX_ORGANIZATION_MEMBERS) throw new Error(`${seated.length} seats is more than an organization's ${MAX_ORGANIZATION_MEMBERS} members`);
    const keep = new Set(seated);
    const rows = await ctx.db.query("memberSeats").withIndex("by_workspace_and_member", (q) => q.eq("workspaceId", workspaceId)).take(MAX_ORGANIZATION_MEMBERS + 1);
    for (const row of rows) if (!keep.delete(row.clerkUserId)) await ctx.db.delete("memberSeats", row._id);
    for (const clerkUserId of keep) await ctx.db.insert("memberSeats", { workspaceId, clerkUserId });
    return null;
  },
});

/** How long a sync holds its organization before another may start: longer than an action runs. */
const SYNC_LEASE_MS = 15 * 60_000;

/** Starts a sync of the organization's seats, unless one is running: then it runs once more after that one. */
export const claim = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.boolean(),
  handler: async (ctx, { workspaceId }) => {
    const row = await seatSyncRow(ctx, workspaceId);
    const now = Date.now();
    if (row?.runningSince !== undefined && now - row.runningSince < SYNC_LEASE_MS) {
      await ctx.db.patch("seatSyncs", row._id, { again: true });
      return false;
    }
    if (row) await ctx.db.patch("seatSyncs", row._id, { runningSince: now, again: undefined });
    else await ctx.db.insert("seatSyncs", { workspaceId, seats: 0, runningSince: now });
    return true;
  },
});

/** Ends a sync, keeping the seats it left, and runs the one asked for meanwhile. */
export const release = internalMutation({
  args: { workspaceId: v.id("workspaces"), seats: v.optional(v.number()), held: v.optional(v.number()), ended: v.optional(v.literal(true)) },
  returns: v.null(),
  handler: async (ctx, { workspaceId, seats, held, ended }) => {
    const row = await seatSyncRow(ctx, workspaceId);
    if (!row) return null;
    await ctx.db.patch("seatSyncs", row._id, { runningSince: undefined, again: undefined, ...(seats === undefined ? {} : { seats, held }), ...(ended ? { ending: undefined } : {}) });
    if (row.again) await ctx.scheduler.runAfter(0, internal.billing.seats.sync, { workspaceId });
    return null;
  },
});

/** Runs `work` holding the organization's sync, and keeps what it left; refuses while another sync runs. */
async function holdingSync(ctx: ActionCtx, workspaceId: Id<"workspaces">, work: () => Promise<Synced | undefined>) {
  if (!(await ctx.runMutation(internal.billing.seats.claim, { workspaceId }))) throw createError("CONFLICT", "Its seats are being updated. Try again in a minute.");
  let synced: Synced | undefined;
  try {
    synced = await work();
  } finally {
    await ctx.runMutation(internal.billing.seats.release, { workspaceId, ...(synced === undefined ? {} : { seats: synced.seats, held: synced.held }), ...(synced?.ended ? { ended: true as const } : {}) });
  }
}

/** Organizations each run of `syncTeams` schedules a sync for, before it carries on in the next. */
const TEAMS_PAGE = 100;

/**
 * The daily check that catches a change an event missed, and frees the seats held to a renewal
 * once it has passed: syncs every organization on Team, then every one still holding seats, then
 * every one that's gone whose sync hasn't ended everything of Team yet. One on two lists syncs
 * twice, which changes nothing the second time.
 */
export const syncTeams = internalMutation({
  args: { paginationOpts: v.optional(paginationOptsValidator), list: v.optional(v.union(v.literal("holding"), v.literal("ending"))) },
  returns: v.null(),
  handler: async (ctx, { paginationOpts, list }) => {
    const opts = paginationOpts ?? { cursor: null, numItems: TEAMS_PAGE };
    const page =
      list === "holding"
        ? await ctx.db.query("seatSyncs").withIndex("by_seats", (q) => q.gt("seats", 0)).paginate(opts)
        : list === "ending"
          ? await ctx.db.query("seatSyncs").withIndex("by_ending", (q) => q.eq("ending", true)).paginate(opts)
          : await ctx.db.query("billingAccounts").withIndex("by_plan", (q) => q.eq("plan", TEAM_PLAN)).paginate(opts);
    for (const row of page.page) await ctx.scheduler.runAfter(0, internal.billing.seats.sync, { workspaceId: row.workspaceId });
    const following = list === undefined ? "holding" : list === "holding" ? "ending" : undefined;
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.billing.seats.syncTeams, { paginationOpts: { cursor: page.continueCursor, numItems: TEAMS_PAGE }, ...(list ? { list } : {}) });
    else if (following) await ctx.scheduler.runAfter(0, internal.billing.seats.syncTeams, { list: following });
    return null;
  },
});

/** Syncs the organization's seats. */
export const sync = internalAction({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }): Promise<null> => {
    if (!(await ctx.runMutation(internal.billing.seats.claim, { workspaceId }))) return null;
    let synced: Synced | undefined;
    try {
      synced = await syncSeats(ctx, workspaceId);
    } finally {
      await ctx.runMutation(internal.billing.seats.release, { workspaceId, ...(synced === undefined ? {} : { seats: synced.seats, held: synced.held }), ...(synced?.ended ? { ended: true as const } : {}) });
    }
    return null;
  },
});

/**
 * Ends an organization's Team plan and its seats at once, as deleting it does, refunding the rest
 * of the period to its balance. It holds the organization's sync while it does, so no sync that
 * read Team before can seat anyone after, and refuses while another sync runs or Autumn still shows
 * a seat or Team: a deletion goes ahead only once nothing of Team is left to bill.
 */
export const endTeam = internalAction({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }): Promise<null> => {
    // Marked first, so whatever stops this partway, the daily check carries on until nothing of Team is left.
    await ctx.runMutation(internal.billing.seats.markEnding, { workspaceId });
    await holdingSync(ctx, workspaceId, async () => {
      const customerId: string = await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId });
      if ((await refreshAccount(ctx, workspaceId)).plan === TEAM_PLAN) await autumn.update({ customerId, planId: TEAM_PLAN, cancelAction: "cancel_immediately" });
      const synced = await syncSeats(ctx, workspaceId);
      if ((await autumn.seatHolders(customerId)).list.length || (await refreshAccount(ctx, workspaceId)).plan === TEAM_PLAN) throw createError("CONFLICT", "Its Team plan is still ending. Try again in a minute.");
      return synced;
    });
    return null;
  },
});

/** Seats of the Team seat plan, as Autumn's Licenses count them. */
export const teamSeats = (quantity: number) => ({ licensePlanId: SEAT_PLAN, quantity });

/** Refuses a charge Autumn reports declined: it changed nothing, and the person is told why. */
export function unlessDeclined<T extends { required_action?: { code: string; reason?: string } | null }>(result: T): T {
  if (result.required_action?.code === "payment_failed") throw createError("BILLING_PAYMENT_DECLINED", `${result.required_action.reason ?? "The card was declined."} Nothing was charged.`);
  return result;
}

/**
 * Sets how many seats an organization on Team holds (#862), down to those in use: its members,
 * pending invitations and seats held to the renewal. An added seat is charged for the days left
 * to the renewal; a removed one is credited to the next bill. Returns the page to pay on when the
 * card asks to confirm the charge; a declined card changes nothing.
 */
export async function setSeats(ctx: ActionCtx, workspaceId: Id<"workspaces">, seats: number): Promise<string | null> {
  const counted: { members: number; invitations: number; held: number } | null = await ctx.runQuery(internal.billing.seats.countsFor, { workspaceId });
  if ((await refreshAccount(ctx, workspaceId)).plan !== TEAM_PLAN || !counted) throw createError("VALIDATION_ERROR", "Seats are bought on the Team plan.");
  const inUse = counted.members + counted.invitations + counted.held;
  if (!Number.isInteger(seats) || seats < inUse || seats > MAX_ORGANIZATION_MEMBERS)
    throw createError("VALIDATION_ERROR", `${inUse} seats are in use by members, invitations and seats held to the renewal; it can hold ${inUse} to ${MAX_ORGANIZATION_MEMBERS.toLocaleString("en")}.`);
  const customerId: string = await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId });
  const changed = unlessDeclined(await autumn.update({ customerId, planId: TEAM_PLAN, seats: teamSeats(seats) }));
  await ctx.runAction(internal.billing.seats.sync, { workspaceId });
  return changed.payment_url;
}

const countsValidator = v.object({ members: v.number(), invitations: v.number(), seats: v.number(), held: v.number() });

/** An organization's members and pending invitations, each counted in full up to MAX_ORGANIZATION_MEMBERS, and the seats it bought and holds for members who left. */
async function countsOf(ctx: QueryCtx, workspaceId: Id<"workspaces">, organizationId: Id<"organizations">) {
  const members = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organizationId).eq("state", "active")).take(MAX_ORGANIZATION_MEMBERS);
  const invitations = await ctx.db.query("organizationInvitations").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organizationId).eq("state", "pending")).take(MAX_ORGANIZATION_MEMBERS);
  const row = await seatSyncRow(ctx, workspaceId);
  const team = (await readAccount(ctx, workspaceId))?.plan === TEAM_PLAN;
  return { members: members.length, invitations: invitations.length, seats: team ? (row?.seats ?? 0) : 0, held: team ? (row?.held ?? 0) : 0 };
}

/**
 * An organization's members, pending invitations, the seats it bought and the seats held by members
 * who left (#862, #863), counted in full: on Team the first three and the held ones fill the seats,
 * and Free has room for FREE_MEMBERS, invitations included. Null outside an organization and for
 * someone not in it.
 */
export const counts = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(countsValidator, v.null()),
  handler: async (ctx, { workspaceId }) => {
    const user = await getCurrentUser(ctx);
    const workspace = await ctx.db.get("workspaces", workspaceId);
    if (!user || workspace?.kind !== "organization" || !(await actorIn(ctx, user, workspaceId))) return null;
    return await countsOf(ctx, workspaceId, workspace.organizationId);
  },
});

/** The same counts, for an action. */
export const countsFor = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(countsValidator, v.null()),
  handler: async (ctx, { workspaceId }) => {
    const workspace = await ctx.db.get("workspaces", workspaceId);
    return workspace?.kind === "organization" ? await countsOf(ctx, workspaceId, workspace.organizationId) : null;
  },
});
