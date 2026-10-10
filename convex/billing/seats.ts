/**
 * Seats follow memberships (#652). An organization on the Team plan has one seat for each active
 * member: an Autumn entity named by the member's Clerk user ID, holding the seat plan, which bills
 * per seat and adds its credits to the organization's one pool. A member who joins gets one; a
 * member who leaves has theirs ended at once, which refunds the rest of its period and takes its
 * credits back out of the pool; an organization off Team has none.
 *
 * `sync` brings Autumn to that from what Convex holds, so running it again changes nothing: it
 * runs on each membership change, on each Autumn event for the organization, and daily.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { internalAction, internalMutation, internalQuery, type ActionCtx } from "../lib/functions";
import { personName } from "../lib/people";
import { MAX_ORGANIZATION_MEMBERS } from "../lib/queryBounds";
import { SEAT_PLAN, SEATS_FEATURE, TEAM_PLAN } from "../../lib/billing/plans";
import { refreshAccount } from "./accounts";
import { autumn, AutumnError, type AutumnEntity } from "./autumn";

export type SeatMember = { clerkUserId: string; name: string };

/** Entities read from Autumn in one call. */
const ENTITIES_PAGE = 100;

/**
 * What to change so each member holds one seat and nobody else does: the members to seat (with
 * whether their entity must be made first), and the entities to end (with whether they hold a seat).
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
    end: entities.filter((entity) => !memberIds.has(entity.id)).map((entity) => ({ entityId: entity.id, seated: seated(entity) })),
  };
}

/** The organization's active members, or null when it has more than one read takes: then no seat changes. */
export const membersOf = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.array(v.object({ clerkUserId: v.string(), name: v.string() })), v.null()),
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
        return { clerkUserId, name: (user && (personName(user) || user.email)) || clerkUserId };
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

async function entitiesOf(customerId: string) {
  const entities: AutumnEntity[] = [];
  for (let cursor: string | null = null; ;) {
    const page: { list: AutumnEntity[]; next_cursor: string | null } = await autumn.listEntities(customerId, cursor, ENTITIES_PAGE);
    entities.push(...page.list);
    if (!page.next_cursor) return entities;
    cursor = page.next_cursor;
  }
}

async function syncSeats(ctx: ActionCtx, workspaceId: Id<"workspaces">) {
  const account = await refreshAccount(ctx, workspaceId);
  const customerId: string = await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId });
  const members: SeatMember[] | null = account.plan === TEAM_PLAN ? await ctx.runQuery(internal.billing.seats.membersOf, { workspaceId }) : [];
  if (members === null) {
    console.error(`[seats] ${workspaceId} has more than ${MAX_ORGANIZATION_MEMBERS} members; its seats are left as they are`);
    return;
  }
  const entities = await entitiesOf(customerId);
  const { seat, end } = seatChanges(members, entities);
  for (const member of seat) {
    if (member.make) await unlessAlready("entity_already_exists", () => autumn.createEntity({ customerId, entityId: member.clerkUserId, featureId: SEATS_FEATURE, name: member.name }));
    const attached = await unlessAlready("plan_already_attached", () => autumn.attach({ customerId, entityId: member.clerkUserId, planId: SEAT_PLAN }));
    // Seats are charged to the organization's saved card; without one, Autumn asks for checkout instead.
    if (attached?.payment_url) {
      console.error(`[seats] ${workspaceId} has no saved card, so ${member.clerkUserId}'s seat wasn't added`);
      return;
    }
  }
  for (const entity of end) {
    if (entity.seated) await unlessAlready("cus_product_not_found", () => autumn.update({ customerId, entityId: entity.entityId, planId: SEAT_PLAN, cancelAction: "cancel_immediately" }));
    await unlessAlready("entity_not_found", () => autumn.deleteEntity(customerId, entity.entityId));
  }
  if (seat.length || end.length) {
    await refreshAccount(ctx, workspaceId);
    console.log(`[seats] ${workspaceId} on ${account.plan}: ${members.length} members; seated ${seat.length}, ended ${end.length}`);
  }
}

/** Team accounts each run of `syncTeams` schedules a sync for, before it carries on in the next. */
const TEAMS_PAGE = 100;

/** Syncs every Team organization's seats: the daily check that catches a change an event missed. */
export const syncTeams = internalMutation({
  args: { paginationOpts: v.optional(paginationOptsValidator) },
  returns: v.null(),
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db
      .query("billingAccounts")
      .withIndex("by_plan", (q) => q.eq("plan", TEAM_PLAN))
      .paginate(paginationOpts ?? { cursor: null, numItems: TEAMS_PAGE });
    for (const account of page.page) await ctx.scheduler.runAfter(0, internal.billing.seats.sync, { workspaceId: account.workspaceId });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.billing.seats.syncTeams, { paginationOpts: { cursor: page.continueCursor, numItems: TEAMS_PAGE } });
    return null;
  },
});

export const sync = internalAction({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    await syncSeats(ctx, workspaceId);
    return null;
  },
});
