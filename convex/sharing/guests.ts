/**
 * An item's guests, as the members of its workspace keep them (#653): someone in one of
 * their own organizations is given it at once, anyone else is invited by email
 * (./invitations.ts). Only the item's workspace shares it; a guest can't.
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { planLimit } from "../billing/accounts";
import { createError } from "../lib/errors";
import { countOf } from "../lib/listCounts";
import { personName } from "../lib/people";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, userMutation, userQuery } from "../lib/userActions";
import { readMemberOrganizations } from "../organizationFeatures";
import schema from "../schema";
import { actorIn } from "../workspaces/actor";
import { give, invitationTo } from "./access";
import { grantOf, itemGuestsOf, requireRole, sharedIn } from "./items";
import { guestRoleValidator, sharedKindValidator } from "./validators";

/** Most guests or invitations one page of the share dialog holds. */
const GUESTS_PAGE_MAX = 50;
const CANDIDATES_PAGE_MAX = 20;
/** Organization members one page of suggestions looks through for the ones the text matches. */
const CANDIDATE_ROWS = 500;

/** A guest as a change names them: someone given the item, or an address invited to it. */
const guestValidator = v.union(v.object({ userId: v.id("users") }), v.object({ email: v.string() }));

const ROLES = "to view it (`viewer`: open, read and export) or to edit it (`editor`: also put papers in a collection and take them out; a screening or an extraction is shared to view only)";

export const addAction = defineUserMutation({
  path: "sharing/guests:add",
  description:
    `Gives someone outside the workspace one of its items, ${ROLES}, or changes what they may do. Any member of the item's workspace can, for a person in one of their own organizations; ` +
    "anyone else is invited by email (sharing/invitations:invite). The item shows under that person's Shared with me, and what they run on it uses their own credits. " +
    "The workspace's plan allows so many guests on each item, invitations still waiting included.",
  args: { kind: sharedKindValidator, id: v.string(), userId: v.id("users"), role: guestRoleValidator },
  returns: v.null(),
  spendsCredits: false,
  // Someone else gains access to the item.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor, { kind, id, userId, role }) => {
    requireRole(kind, role);
    const shared = await sharedIn(ctx, actor, kind, id);
    const [sharer, person] = await Promise.all([ctx.db.get("users", actor.userId), ctx.db.get("users", userId)]);
    if (!sharer || person?.state !== "active") throw createError("NOT_FOUND", "Person not found");
    if (await actorIn(ctx, person, shared.workspaceId)) throw createError("CONFLICT", "They're in this workspace, so they have it already.");
    // Never a stranger by ID: someone in one of the sharer's organizations.
    const mine = new Set((await readMemberOrganizations(ctx, sharer)).map(({ organization }) => organization._id));
    if (!(await readMemberOrganizations(ctx, person)).some(({ organization }) => mine.has(organization._id))) throw createError("FORBIDDEN", "Invite people outside your organizations by email.");
    await give(ctx, shared, person, role, actor);
    return null;
  },
});
export const add = userMutation(addAction);
export const addForAssistant = assistantMutation(addAction);

export const setRoleAction = defineUserMutation({
  path: "sharing/guests:setRole",
  description: `Changes what a guest of one of the workspace's items may do: ${ROLES}. The guest is someone given it (\`userId\`) or an address invited to it that hasn't answered (\`email\`).`,
  args: { kind: sharedKindValidator, id: v.string(), guest: guestValidator, role: guestRoleValidator },
  returns: v.null(),
  spendsCredits: false,
  // Someone else's access to the item changes.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor, { kind, id, guest, role }) => {
    requireRole(kind, role);
    const shared = await sharedIn(ctx, actor, kind, id);
    if ("userId" in guest) {
      const grant = await grantOf(ctx, shared.id, guest.userId);
      if (!grant) throw createError("NOT_FOUND", "They aren't a guest of it.");
      if (grant.role !== role) await ctx.db.patch("itemAccess", grant._id, { role });
      return null;
    }
    const invitation = await invitationTo(ctx, shared.id, guest.email.trim().toLowerCase());
    if (invitation?.state !== "pending") throw createError("NOT_FOUND", "That invitation isn't waiting any more.");
    if (invitation.role !== role) await ctx.db.patch("itemInvitations", invitation._id, { role });
    return null;
  },
});
export const setRole = userMutation(setRoleAction);
export const setRoleForAssistant = assistantMutation(setRoleAction);

export const removeAction = defineUserMutation({
  path: "sharing/guests:remove",
  description: "Takes one of the workspace's items back from a guest: someone given it (`userId`), who can no longer open it, or an address invited to it (`email`), whose link stops working.",
  args: { kind: sharedKindValidator, id: v.string(), guest: guestValidator },
  returns: v.null(),
  spendsCredits: false,
  // Someone else loses access to the item.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor, { kind, id, guest }) => {
    const shared = await sharedIn(ctx, actor, kind, id);
    if ("userId" in guest) {
      const grant = await grantOf(ctx, shared.id, guest.userId);
      if (grant) await ctx.db.delete("itemAccess", grant._id);
      return null;
    }
    const invitation = await invitationTo(ctx, shared.id, guest.email.trim().toLowerCase());
    if (invitation?.state === "pending") await ctx.db.patch("itemInvitations", invitation._id, { state: "cancelled" });
    return null;
  },
});
export const remove = userMutation(removeAction);
export const removeForAssistant = assistantMutation(removeAction);

export const leaveAction = defineUserMutation({
  path: "sharing/guests:leave",
  description: "Gives up the person's own place as a guest of an item shared with them. It leaves their Shared with me, and they can't open it until it's shared with them again.",
  args: { id: v.string() },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, { userId }, { id }) => {
    const grant = await grantOf(ctx, id, userId);
    if (grant) await ctx.db.delete("itemAccess", grant._id);
    return null;
  },
});
export const leave = userMutation(leaveAction);
export const leaveForAssistant = assistantMutation(leaveAction);

const kindAndId = { kind: sharedKindValidator, id: v.string() };

export const roomAction = defineUserQuery({
  path: "sharing/guests:room",
  description: "How many guests one of the workspace's items has, invitations still waiting included, and how many its plan allows on each item (null for no limit).",
  args: kindAndId,
  returns: v.object({ used: v.number(), limit: v.union(v.number(), v.null()) }),
  run: async (ctx, actor, { kind, id }) => {
    const shared = await sharedIn(ctx, actor, kind, id);
    return { used: await countOf(ctx, itemGuestsOf(shared.id)), limit: (await planLimit(ctx, shared.workspaceId, "guests")) ?? null };
  },
});
export const room = userQuery(roomAction);
export const roomForAssistant = assistantQuery(roomAction);

export const listAction = defineUserQuery({
  path: "sharing/guests:list",
  description: "Lists the guests of one of the workspace's items, a page at a time, in the order they were given it: people outside the workspace, each with what they may do (`viewer` or `editor`).",
  args: { ...kindAndId, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ userId: v.id("users"), name: v.string(), email: v.string(), imageUrl: v.optional(v.string()), role: guestRoleValidator })),
  run: async (ctx, actor, { kind, id, paginationOpts }) => {
    const shared = await sharedIn(ctx, actor, kind, id);
    const read = await ctx.db.query("itemAccess").withIndex("by_item_and_grantedAt", (q) => q.eq("item", shared.id)).paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, GUESTS_PAGE_MAX) });
    const page = await Promise.all(read.page.map(async ({ userId, role }) => {
      const person = await ctx.db.get("users", userId);
      return person ? [{ userId, name: personName(person), email: person.email, ...(person.avatarUrl ? { imageUrl: person.avatarUrl } : {}), role }] : [];
    }));
    return { ...read, page: page.flat() };
  },
});
export const list = userQuery(listAction);
export const listForAssistant = assistantQuery(listAction);

export const invitedAction = defineUserQuery({
  path: "sharing/guests:invited",
  description: "Lists the invitations to one of the workspace's items that haven't been answered, a page at a time: each one's address, what it would let them do, and when it expires.",
  args: { ...kindAndId, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ email: v.string(), role: guestRoleValidator, expiresAt: v.number(), delivery: v.union(v.literal("queued"), v.literal("sent"), v.literal("failed")) })),
  run: async (ctx, actor, { kind, id, paginationOpts }) => {
    const shared = await sharedIn(ctx, actor, kind, id);
    const read = await ctx.db.query("itemInvitations").withIndex("by_item_and_state", (q) => q.eq("item", shared.id).eq("state", "pending")).paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, GUESTS_PAGE_MAX) });
    return { ...read, page: read.page.map(({ email, role, expiresAt, delivery }) => ({ email, role, expiresAt, delivery })) };
  },
});
export const invited = userQuery(invitedAction);
export const invitedForAssistant = assistantQuery(invitedAction);

export const candidatesAction = defineUserQuery({
  path: "sharing/guests:candidates",
  description:
    "Suggests who one of the workspace's items could be given to at once (sharing/guests:add), a page at a time: the people in the person's organizations who aren't in the item's workspace and aren't its guests yet. " +
    "Given `text`, only those whose name or email contains it. A page can be short while more remain, since it only looks through so many members at once. Anyone else is invited by email (sharing/invitations:invite).",
  args: { ...kindAndId, text: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ userId: v.id("users"), name: v.string(), email: v.string(), imageUrl: v.optional(v.string()) })),
  run: async (ctx, actor, { kind, id, text, paginationOpts }) => {
    const shared = await sharedIn(ctx, actor, kind, id);
    const me = await ctx.db.get("users", actor.userId);
    const mine = me ? await readMemberOrganizations(ctx, me) : [];
    if (!me || !mine.length) return { page: [], isDone: true, continueCursor: "" };
    const needle = text?.trim().toLowerCase() ?? "";
    // Someone in several of those organizations is one membership in each, so they show once on a page; the dialog drops a repeat on a later page.
    const seen = new Set<string>([me.clerkId]);
    const found = new Map<string, Doc<"users">>();
    const read = await mergedStream(
      mine.map(({ organization }) => stream(ctx.db, schema).query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organization._id).eq("state", "active"))),
      ["_creationTime"],
    )
      .filterWith(async (membership) => {
        if (seen.has(membership.clerkUserId)) return false;
        seen.add(membership.clerkUserId);
        const person = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", membership.clerkUserId)).unique();
        if (person?.state !== "active" || (needle && !`${personName(person)}\n${person.email}`.toLowerCase().includes(needle))) return false;
        if ((await actorIn(ctx, person, shared.workspaceId)) || (await grantOf(ctx, shared.id, person._id))) return false;
        found.set(membership.clerkUserId, person);
        return true;
      })
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, CANDIDATES_PAGE_MAX), maximumRowsRead: CANDIDATE_ROWS });
    return {
      ...read,
      page: read.page.flatMap((membership) => {
        const person = found.get(membership.clerkUserId);
        return person ? [{ userId: person._id, name: personName(person), email: person.email, ...(person.avatarUrl ? { imageUrl: person.avatarUrl } : {}) }] : [];
      }),
    };
  },
});
export const candidates = userQuery(candidatesAction);
export const candidatesForAssistant = assistantQuery(candidatesAction);
