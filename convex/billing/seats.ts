/**
 * Seats follow memberships (#652). An organization on the Team plan has one seat for each active
 * member: an Autumn entity named by the member's Clerk user ID, holding the seat plan, which bills
 * per seat and adds its credits to the organization's one pool. A member who joins gets one; a
 * member who leaves has theirs ended at once, which refunds the rest of its period and takes its
 * credits back out of the pool; an organization off Team has none.
 *
 * `sync` brings Autumn to that from what Convex holds, so running it again changes nothing: it
 * runs on each membership change, on each Autumn event for the organization, and daily for every
 * organization on Team or still holding seats. One runs at a time for an organization; one asked
 * for meanwhile runs once more after it.
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
import { SEAT_PLAN, SEATS_FEATURE, TEAM_PLAN } from "../../lib/billing/plans";
import { createError } from "../lib/errors";
import { refreshAccount } from "./accounts";
import { capRow } from "./memberCaps";
import { autumn, AutumnError, type AutumnEntity } from "./autumn";

/** A member as a seat is made for them: the cap an admin set on them goes on their new entity. */
export type SeatMember = { clerkUserId: string; name: string; cap?: number };

/** Entities read from Autumn in one call. */
const ENTITIES_PAGE = 100;

/**
 * Most entities one sync reads: a seat for every member, with room for seats of members who left
 * that are still to end. Past it the customer isn't one sync's to fix; it says so.
 */
const MAX_ENTITIES_READ = 2 * MAX_ORGANIZATION_MEMBERS;

/**
 * What to change so each member holds one seat and nobody else does: the members to seat (with
 * whether their entity must be made first), and the entities to end.
 */
export function seatChanges(members: SeatMember[], entities: AutumnEntity[]) {
  const seated = (entity: AutumnEntity) => entity.subscriptions.some((s) => s.plan_id === SEAT_PLAN && s.status === "active");
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const memberIds = new Set(members.map((member) => member.clerkUserId));
  return {
    seat: members.flatMap((member) => {
      const entity = byId.get(member.clerkUserId);
      return entity && seated(entity) ? [] : [{ ...member, make: !entity }];
    }),
    end: entities.filter((entity) => !memberIds.has(entity.id)).map((entity) => entity.id),
  };
}

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

/** Runs an Autumn call whose `code` failure means it's already done, such as making an entity that exists. */
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

/**
 * Brings the organization's seats to its members, and says how many seats it holds after, with the
 * page that confirms a seat's payment when its card asked for one (3-D Secure, say); undefined when
 * it changed nothing.
 */
async function syncSeats(ctx: ActionCtx, workspaceId: Id<"workspaces">): Promise<{ seats: number; paymentUrl?: string } | undefined> {
  const account = await refreshAccount(ctx, workspaceId);
  const customerId: string = await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId });
  const members: SeatMember[] | null = account.plan === TEAM_PLAN ? await ctx.runQuery(internal.billing.seats.membersOf, { workspaceId }) : [];
  if (members === null) {
    console.error(`[seats] ${workspaceId} has more than ${MAX_ORGANIZATION_MEMBERS} members; its seats are left as they are`);
    return undefined;
  }
  const entities = await entitiesOf(customerId);
  if (entities === null) {
    console.error(`[seats] ${workspaceId}'s customer has more than ${MAX_ENTITIES_READ} entities; its seats are left as they are`);
    return undefined;
  }
  const { seat, end } = seatChanges(members, entities);
  // Departures first, so a missing card never keeps a seat that should end. Each is cancelled
  // whatever the listing said: a seat attached since must still be refunded before it goes.
  for (const entityId of end) {
    await unlessAlready("cus_product_not_found", () => autumn.update({ customerId, entityId, planId: SEAT_PLAN, cancelAction: "cancel_immediately" }));
    await unlessAlready("entity_not_found", () => autumn.deleteEntity(customerId, entityId));
  }
  let added = 0;
  let paymentUrl: string | undefined;
  for (const member of seat) {
    if (member.make) await unlessAlready("entity_already_exists", () => autumn.createEntity({ customerId, entityId: member.clerkUserId, featureId: SEATS_FEATURE, name: member.name, ...(member.cap === undefined ? {} : { cap: member.cap }) }));
    const attached = await unlessAlready("plan_already_attached", () => autumn.attach({ customerId, entityId: member.clerkUserId, planId: SEAT_PLAN }));
    // Seats are charged to the organization's saved card; without one, or when the card asks to confirm the payment, Autumn sends a page to pay on instead.
    if (attached?.payment_url) {
      console.error(`[seats] ${workspaceId}'s card wasn't charged without a payment page, so ${seat.length - added} new members' seats weren't added`);
      paymentUrl = attached.payment_url;
      break;
    }
    added++;
  }
  // Charges are made as a member's entity from now on, and no longer as one whose seat ended.
  const waiting = new Set(seat.slice(added).map((member) => member.clerkUserId));
  await ctx.runMutation(internal.billing.seats.recordSeats, { workspaceId, seated: members.flatMap((member) => (waiting.has(member.clerkUserId) ? [] : [member.clerkUserId])) });
  if (seat.length || end.length) {
    await refreshAccount(ctx, workspaceId);
    console.log(`[seats] ${workspaceId} on ${account.plan}: ${members.length} members; seated ${added}, ended ${end.length}`);
  }
  return { seats: members.length - waiting.size, ...(paymentUrl ? { paymentUrl } : {}) };
}

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

const syncRow = (ctx: QueryCtx, workspaceId: Id<"workspaces">) => ctx.db.query("seatSyncs").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();

/** Starts a sync of the organization's seats, unless one is running: then it runs once more after that one. */
export const claim = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.boolean(),
  handler: async (ctx, { workspaceId }) => {
    const row = await syncRow(ctx, workspaceId);
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

/** Ends a sync, keeping how many seats it left, and runs the one asked for meanwhile. */
export const release = internalMutation({
  args: { workspaceId: v.id("workspaces"), seats: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { workspaceId, seats }) => {
    const row = await syncRow(ctx, workspaceId);
    if (!row) return null;
    await ctx.db.patch("seatSyncs", row._id, { runningSince: undefined, again: undefined, ...(seats === undefined ? {} : { seats }) });
    if (row.again) await ctx.scheduler.runAfter(0, internal.billing.seats.sync, { workspaceId });
    return null;
  },
});

/** Organizations each run of `syncTeams` schedules a sync for, before it carries on in the next. */
const TEAMS_PAGE = 100;

/**
 * The daily check that catches a change an event missed: syncs every organization on Team, then
 * every one still holding seats, such as one that left Team and whose seats couldn't all end yet.
 * One on both lists syncs twice, which changes nothing the second time.
 */
export const syncTeams = internalMutation({
  args: { paginationOpts: v.optional(paginationOptsValidator), holding: v.optional(v.literal(true)) },
  returns: v.null(),
  handler: async (ctx, { paginationOpts, holding }) => {
    const opts = paginationOpts ?? { cursor: null, numItems: TEAMS_PAGE };
    const page = holding
      ? await ctx.db.query("seatSyncs").withIndex("by_seats", (q) => q.gt("seats", 0)).paginate(opts)
      : await ctx.db.query("billingAccounts").withIndex("by_plan", (q) => q.eq("plan", TEAM_PLAN)).paginate(opts);
    for (const row of page.page) await ctx.scheduler.runAfter(0, internal.billing.seats.sync, { workspaceId: row.workspaceId });
    const next = { cursor: page.continueCursor, numItems: TEAMS_PAGE };
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.billing.seats.syncTeams, { paginationOpts: next, ...(holding ? { holding } : {}) });
    else if (!holding) await ctx.scheduler.runAfter(0, internal.billing.seats.syncTeams, { holding: true });
    return null;
  },
});

/** Syncs the organization's seats; returns the page that confirms a seat's payment when its card asked for one. */
export const sync = internalAction({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { workspaceId }): Promise<string | null> => {
    if (!(await ctx.runMutation(internal.billing.seats.claim, { workspaceId }))) return null;
    let synced: { seats: number; paymentUrl?: string } | undefined;
    try {
      synced = await syncSeats(ctx, workspaceId);
    } finally {
      await ctx.runMutation(internal.billing.seats.release, { workspaceId, ...(synced === undefined ? {} : { seats: synced.seats }) });
    }
    return synced?.paymentUrl ?? null;
  },
});

/**
 * Starts an organization's Team seats (#652) once its saved card is known: Team attached and a seat
 * for each member, holding the organization's sync while it does, so the sync Autumn's webhook
 * asks for runs after and the page that confirms a seat's payment comes back here. Refuses while
 * another sync runs.
 */
export const startTeam = internalAction({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { workspaceId }): Promise<string | null> => {
    if (!(await ctx.runMutation(internal.billing.seats.claim, { workspaceId }))) throw createError("CONFLICT", "Its seats are being updated. Try again in a minute.");
    let synced: { seats: number; paymentUrl?: string } | undefined;
    try {
      const customerId: string = await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId });
      await autumn.attach({ customerId, planId: TEAM_PLAN, idempotencyKey: `team-${workspaceId}-${crypto.randomUUID()}` });
      synced = await syncSeats(ctx, workspaceId);
    } finally {
      await ctx.runMutation(internal.billing.seats.release, { workspaceId, ...(synced === undefined ? {} : { seats: synced.seats }) });
    }
    return synced?.paymentUrl ?? null;
  },
});

const countsValidator = v.object({ members: v.number(), invitations: v.number(), seats: v.number() });

/** An organization's members, pending invitations and the seats it holds, each counted in full up to MAX_ORGANIZATION_MEMBERS. */
async function countsOf(ctx: QueryCtx, workspaceId: Id<"workspaces">, organizationId: Id<"organizations">) {
  const members = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organizationId).eq("state", "active")).take(MAX_ORGANIZATION_MEMBERS);
  const invitations = await ctx.db.query("organizationInvitations").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organizationId).eq("state", "pending")).take(MAX_ORGANIZATION_MEMBERS);
  return { members: members.length, invitations: invitations.length, seats: (await syncRow(ctx, workspaceId))?.seats ?? 0 };
}

/**
 * An organization's members, pending invitations and the seats it holds (#652), counted in full,
 * for what Team costs it and whether Free takes it: moving to Team charges a seat for each member,
 * its bill is a seat for each one it holds, and Free has room for FREE_MEMBERS, invitations
 * included. Null outside an organization and for someone not in it.
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
