// Organizations in OpenScholar (#651): making one, its members, invitations and roles, leaving
// and deleting. Each change is Clerk's: these actions call its Backend API, then keep what it
// answered as its webhook would (convex/webhooks/clerk.ts), so a page needn't wait for the
// webhook. Clerk's own event for the same change applies again, or is older and skipped.

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { ClerkApiError, clerkRequest, clerkSecretKey, isRecord } from "../lib/clerk";
import { requireAppUrl } from "../lib/env";
import { createError } from "../lib/errors";
import { assistantAction, defineUserAction, reversedBy, userAction, type Acting } from "../lib/userActions";
import { processClerkWebhookEvent } from "../webhooks/clerk";
import type { Actor } from "../workspaces/actor";

/** What a change to an organization's people starts from (./read.ts `context`). */
type Context = { clerkUserId: string; email: string; organization: { clerkOrganizationId: string; organizationId: Id<"organizations">; slug: string; name: string } | null };

const ROLE = v.union(v.literal("admin"), v.literal("member"));
type Role = "admin" | "member";
const clerkRole = (role: Role) => (role === "admin" ? "org:admin" : "org:member");

/** The most people one call invites. */
const INVITES_AT_ONCE = 20;

let instanceId: string | undefined;
/** The Clerk instance whose events these are, as the webhook names it. */
async function clerkInstanceId(key: string) {
  if (!instanceId) {
    const { body } = await clerkRequest(key, "GET", "/instance");
    if (!isRecord(body) || typeof body.id !== "string") throw new Error("Clerk answered without its instance ID");
    instanceId = body.id;
  }
  return instanceId;
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Keeps a Clerk object as the webhook would for `eventType`. A deletion answers with no time of
 * its own, so it's ordered at `sentAt`, just before the request: a change after it, such as
 * someone removed and invited back at once, is then newer, whenever the answer arrives.
 */
async function keep(ctx: ActionCtx, key: string, eventType: string, data: unknown, sentAt?: number) {
  const digest = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(eventType + JSON.stringify(data))));
  const outcome = await processClerkWebhookEvent({
    eventId: `api_${digest.slice(0, 32)}`,
    eventType,
    instanceId: await clerkInstanceId(key),
    occurredAt: eventType.endsWith(".deleted") ? (sentAt ?? Date.now()) : isRecord(data) && typeof data.updated_at === "number" ? data.updated_at : Date.now(),
    payloadSha256: digest,
    data,
    runMutation: (mutation, args) => ctx.runMutation(mutation as never, args as never),
  });
  if (outcome.status !== 200) throw new Error(`Couldn't keep what Clerk answered to ${eventType}: ${outcome.body}`);
}

/** What Clerk refused, in the person's words; anything else is thrown as it is. */
function refused(error: unknown): never {
  if (error instanceof ClerkApiError) {
    console.error("[organizations] Clerk refused", { status: error.status, code: error.code, traceId: error.traceId, message: error.message });
    if (error.code === "organization_membership_quota_exceeded" || error.code === "organization_membership_plan_quota_exceeded") {
      throw createError("VALIDATION_ERROR", "This organization has as many members as its plan allows, invitations included.");
    }
    if (error.code === "duplicate_record" || error.code === "already_a_member_in_organization") throw createError("CONFLICT", "That person is already a member or invited.");
    if (error.status === 422 || error.status === 400) throw createError("VALIDATION_ERROR", "Clerk refused this change. Check the name or email and try again.");
  }
  throw error;
}

async function clerk(key: string, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) {
  try {
    return (await clerkRequest(key, method, path, body)).body;
  } catch (error) {
    refused(error);
  }
}

/** The acting person's Clerk ID, and the organization the workspace is, which only its admins change. */
async function inOrganization(ctx: ActionCtx, { userId, workspaceId, role }: Acting, { adminOnly }: { adminOnly: boolean }) {
  const context: Context = await ctx.runQuery(internal.organizations.read.context, { userId, workspaceId });
  if (!context.organization) throw createError("VALIDATION_ERROR", "This is the person's own workspace, not an organization.");
  if (adminOnly && role !== "admin") throw createError("FORBIDDEN", "Only an admin of the organization does this.");
  return { ...context, organization: context.organization };
}

const nameArg = v.string();
function requireName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) throw createError("VALIDATION_ERROR", "An organization's name is 1 to 100 characters.");
  return trimmed;
}

export const createAction = defineUserAction({
  path: "organizations/manage:create",
  description:
    "Creates an organization with the person as its admin: a workspace of its own, which its members share, on the free organization plan with its own credits. " +
    "Returns its workspace ID and `slug`, the part of the address its pages sit under (/o/<slug>). Invite people to it with organizations/manage:invite.",
  args: { name: nameArg },
  returns: v.object({ workspaceId: v.id("workspaces"), slug: v.string() }),
  spendsCredits: false,
  outsideEffect: true,
  undoable: false,
  run: async (ctx, { userId, workspaceId }, { name }): Promise<{ workspaceId: Id<"workspaces">; slug: string }> => {
    const key = clerkSecretKey();
    const { clerkUserId }: Context = await ctx.runQuery(internal.organizations.read.context, { userId, workspaceId });
    const organization = await clerk(key, "POST", "/organizations", { name: requireName(name), created_by: clerkUserId });
    if (!isRecord(organization) || typeof organization.id !== "string") throw new Error("Clerk answered without the organization");
    await keep(ctx, key, "organization.created", organization);
    // Clerk makes its creator an admin; keep that membership too.
    const memberships = await clerk(key, "GET", `/organizations/${organization.id}/memberships?user_id=${encodeURIComponent(clerkUserId)}&limit=1`);
    const mine = isRecord(memberships) && Array.isArray(memberships.data) ? memberships.data[0] : undefined;
    if (mine) await keep(ctx, key, "organizationMembership.created", mine);
    const made: { workspaceId: Id<"workspaces">; slug: string } | null = await ctx.runQuery(internal.organizations.read.workspaceOf, { clerkOrganizationId: organization.id });
    if (!made) throw new Error("The organization Clerk made isn't kept");
    return made;
  },
});
export const create = userAction(createAction);
export const createForAssistant = assistantAction(createAction);

export const inviteAction = defineUserAction({
  path: "organizations/manage:invite",
  description:
    `Invites people to the organization the person is in, by email, as admins or members; an admin of it does this. Clerk emails each a link to join. At most ${INVITES_AT_ONCE} at once. ` +
    "A free organization has up to 5 members, invitations included. Returns how many were invited.",
  args: { emails: v.array(v.string()), role: ROLE },
  returns: v.object({ invited: v.number() }),
  spendsCredits: false,
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor, { emails, role }) => {
    const wanted = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
    if (wanted.length === 0 || wanted.length > INVITES_AT_ONCE) throw createError("VALIDATION_ERROR", `Invite 1 to ${INVITES_AT_ONCE} people at once.`);
    if (wanted.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw createError("VALIDATION_ERROR", "One of these isn't an email address.");
    const key = clerkSecretKey();
    const { clerkUserId, organization } = await inOrganization(ctx, actor, { adminOnly: true });
    const sent = await clerk(
      key,
      "POST",
      `/organizations/${organization.clerkOrganizationId}/invitations/bulk`,
      wanted.map((email) => ({
        email_address: email,
        role: clerkRole(role),
        inviter_user_id: clerkUserId,
        redirect_url: `${requireAppUrl()}/join/${organization.slug}`,
        public_metadata: { inviterClerkUserId: clerkUserId },
      })),
    );
    const invitations = Array.isArray(sent) ? sent : isRecord(sent) && Array.isArray(sent.data) ? sent.data : [];
    for (const invitation of invitations) await keep(ctx, key, "organizationInvitation.created", invitation);
    return { invited: invitations.length };
  },
});
export const invite = userAction(inviteAction);
export const inviteForAssistant = assistantAction(inviteAction);

export const revokeInvitationAction = defineUserAction({
  path: "organizations/manage:revokeInvitation",
  description: "Takes back an invitation to the organization the person is in that hasn't been answered; an admin of it does this. Its link stops working.",
  args: { invitationId: v.id("organizationInvitations") },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, actor, { invitationId }) => {
    const key = clerkSecretKey();
    const { clerkUserId, organization } = await inOrganization(ctx, actor, { adminOnly: true });
    const clerkInvitationId: string = await ctx.runQuery(internal.organizations.read.pendingInvitation, { invitationId, organizationId: organization.organizationId });
    const revoked = await clerk(key, "POST", `/organizations/${organization.clerkOrganizationId}/invitations/${clerkInvitationId}/revoke`, { requesting_user_id: clerkUserId });
    await keep(ctx, key, "organizationInvitation.revoked", revoked);
    return null;
  },
});
export const revokeInvitation = userAction(revokeInvitationAction);
export const revokeInvitationForAssistant = assistantAction(revokeInvitationAction);

export const declineInvitationAction = defineUserAction({
  path: "organizations/manage:declineInvitation",
  description: "Declines an invitation the person was sent to join an organization (from organizations/queries:myInvitations). Its link stops working.",
  args: { invitationId: v.id("organizationInvitations") },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, { userId, workspaceId }, { invitationId }) => {
    const key = clerkSecretKey();
    const { email }: Context = await ctx.runQuery(internal.organizations.read.context, { userId, workspaceId });
    const invitation: { clerkInvitationId: string; clerkOrganizationId: string } = await ctx.runQuery(internal.organizations.read.invitationFor, { invitationId, email });
    const revoked = await clerk(key, "POST", `/organizations/${invitation.clerkOrganizationId}/invitations/${invitation.clerkInvitationId}/revoke`, {});
    await keep(ctx, key, "organizationInvitation.revoked", revoked);
    return null;
  },
});
export const declineInvitation = userAction(declineInvitationAction);
export const declineInvitationForAssistant = assistantAction(declineInvitationAction);

const SET_ROLE = "organizations/manage:setRole" as const;

export const setRoleAction = defineUserAction({
  path: SET_ROLE,
  description:
    "Makes a member of the organization the person is in an admin or a member; an admin of it does this. Admins invite and remove members, change roles, and change the organization's settings. " +
    "An organization always keeps one admin. Returns `undo`, which puts the role back.",
  args: { userId: v.id("users"), role: ROLE },
  returns: v.object({ undo: reversedBy(SET_ROLE, { userId: v.id("users"), role: ROLE }) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, actor, { userId, role }) => {
    const key = clerkSecretKey();
    const { clerkUserId, organization } = await inOrganization(ctx, actor, { adminOnly: true });
    const was = await memberRole(ctx, actor.workspaceId, userId);
    if (was === role) return {};
    const target: string = await ctx.runQuery(internal.organizations.read.checkMemberChange, { workspaceId: actor.workspaceId, actorClerkUserId: clerkUserId, actorIsAdmin: true, userId, becomes: clerkRole(role) });
    const membership = await clerk(key, "PATCH", `/organizations/${organization.clerkOrganizationId}/memberships/${target}`, { role: clerkRole(role) });
    await keep(ctx, key, "organizationMembership.updated", membership);
    return { undo: { path: SET_ROLE, args: { userId, role: was } } };
  },
});
export const setRole = userAction(setRoleAction);
export const setRoleForAssistant = assistantAction(setRoleAction);

/** A member's role in the organization a workspace is. */
async function memberRole(ctx: ActionCtx, workspaceId: Id<"workspaces">, userId: Id<"users">): Promise<Role> {
  const actor: Actor | null = await ctx.runQuery(internal.workspaces.actor.activeActor, { userId, workspaceId }).catch(() => null);
  if (!actor) throw createError("NOT_FOUND", "This person isn't a member of the organization.");
  return actor.role;
}

/** Ends someone's membership through Clerk, once the change is allowed. */
async function endMembership(ctx: ActionCtx, actor: Acting, userId: Id<"users">) {
  const key = clerkSecretKey();
  const { clerkUserId, organization } = await inOrganization(ctx, actor, { adminOnly: false });
  const target: string = await ctx.runQuery(internal.organizations.read.checkMemberChange, { workspaceId: actor.workspaceId, actorClerkUserId: clerkUserId, actorIsAdmin: actor.role === "admin", userId, becomes: "gone" });
  const sentAt = Date.now();
  const membership = await clerk(key, "DELETE", `/organizations/${organization.clerkOrganizationId}/memberships/${target}`);
  await keep(ctx, key, "organizationMembership.deleted", membership, sentAt);
}

export const removeMemberAction = defineUserAction({
  path: "organizations/manage:removeMember",
  description:
    "Removes someone from the organization the person is in; an admin of it does this. What they made stays the organization's. An organization always keeps one admin. " +
    "To leave an organization themselves, the person uses organizations/manage:leave.",
  args: { userId: v.id("users") },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor, { userId }) => {
    if (actor.role !== "admin") throw createError("FORBIDDEN", "Only an admin of the organization removes its members.");
    await endMembership(ctx, actor, userId);
    return null;
  },
});
export const removeMember = userAction(removeMemberAction);
export const removeMemberForAssistant = assistantAction(removeMemberAction);

export const leaveAction = defineUserAction({
  path: "organizations/manage:leave",
  description: "The person leaves the organization they're in. What they made stays the organization's. Its only admin can't leave: they make someone else an admin first.",
  args: {},
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor) => {
    await endMembership(ctx, actor, actor.userId);
    return null;
  },
});
export const leave = userAction(leaveAction);
export const leaveForAssistant = assistantAction(leaveAction);

export const renameAction = defineUserAction({
  path: "organizations/manage:rename",
  description: "Renames the organization the person is in; an admin of it does this. Returns `undo`, which puts the name back.",
  args: { name: nameArg },
  returns: v.object({ undo: reversedBy("organizations/manage:rename", { name: nameArg }) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, actor, { name }) => {
    const key = clerkSecretKey();
    const { organization } = await inOrganization(ctx, actor, { adminOnly: true });
    const renamed = requireName(name);
    if (renamed === organization.name) return {};
    const updated = await clerk(key, "PATCH", `/organizations/${organization.clerkOrganizationId}`, { name: renamed });
    await keep(ctx, key, "organization.updated", updated);
    return { undo: { path: "organizations/manage:rename" as const, args: { name: organization.name } } };
  },
});
export const rename = userAction(renameAction);
export const renameForAssistant = assistantAction(renameAction);

export const deleteOrganizationAction = defineUserAction({
  path: "organizations/manage:deleteOrganization",
  description:
    "Deletes the organization the person is in, and with it every member's access to its workspace; an admin of it does this, and it can't be undone. " +
    "It's refused while the organization has an Evidence Library, which has to be moved or deleted first.",
  args: {},
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor) => {
    const key = clerkSecretKey();
    const { organization } = await inOrganization(ctx, actor, { adminOnly: true });
    const deletingAt: number = await ctx.runMutation(internal.organizations.read.beginDeletion, { workspaceId: actor.workspaceId });
    const sentAt = Date.now();
    try {
      await clerk(key, "DELETE", `/organizations/${organization.clerkOrganizationId}`);
    } catch (error) {
      await ctx.runMutation(internal.organizations.read.endDeletion, { organizationId: organization.organizationId, deletingAt });
      throw error;
    }
    await keep(ctx, key, "organization.deleted", { id: organization.clerkOrganizationId }, sentAt);
    return null;
  },
});
export const deleteOrganization = userAction(deleteOrganizationAction);
export const deleteOrganizationForAssistant = assistantAction(deleteOrganizationAction);
