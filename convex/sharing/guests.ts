/**
 * An item's guests, as the members of its workspace keep them (#653): someone in one of
 * their own organizations is given it at once, anyone else is invited by email
 * (./invitations.ts). Only the item's workspace shares it; a guest can't.
 */
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { assistantMutation, defineUserMutation, userMutation } from "../lib/userActions";
import { readMemberOrganizations } from "../organizationFeatures";
import { actorIn } from "../workspaces/actor";
import { give, grantOf, invitationTo } from "./access";
import { sharedIn } from "./items";
import { guestRoleValidator, sharedKindValidator } from "./validators";

/** A guest as a change names them: someone given the item, or an address invited to it. */
const guestValidator = v.union(v.object({ userId: v.id("users") }), v.object({ email: v.string() }));

const ROLES = "to view it (`viewer`), or to change what's in it and run jobs on it too (`editor`)";

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
