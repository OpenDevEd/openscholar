// Organizations in OpenScholar (#651): making one, its members, invitations and roles, leaving
// and deleting. Each change is Clerk's: these actions call its Backend API, then keep what it
// answered as its webhook would (convex/webhooks/clerk.ts), so a page needn't wait for the
// webhook. Clerk's own event for the same change applies again, or is older and skipped.

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, type ActionCtx } from "../_generated/server";
import { internalAction } from "../lib/functions";
import { ClerkApiError, clerkRequest, clerkSecretKey, isRecord } from "../lib/clerk";
import { requireAppUrl } from "../lib/env";
import { MAX_ORGANIZATION_MEMBERS } from "../lib/queryBounds";
import { FREE_MEMBERS } from "../../lib/billing/plans";
import { setSeats } from "../billing/seats";
import { createError } from "../lib/errors";
import { assistantAction, assistantMutation, defineChangingAction, defineUserMutation, reversedBy, userAction, userMutation, workspaceMutation, type Acting } from "../lib/userActions";
import { processClerkWebhookEvent } from "../webhooks/clerk";
import { ORGANIZATION_COLOURS, type OrganizationColour } from "../../lib/workspaces/colours";
import { deletable, organizationOf, PAST_ROOM_STEP } from "./read";
import { presetKeyValidator } from "../aiModelConfig/validators";
import { DEFAULT_PRESET } from "../../lib/ai/tasks";
import type { Actor } from "../workspaces/actor";

/** What a change to an organization's people starts from (./read.ts `context`). */
type Context = { clerkUserId: string; email: string; organization: { clerkOrganizationId: string; organizationId: Id<"organizations">; slug: string; name: string } | null };

const ROLE = v.union(v.literal("admin"), v.literal("member"));
type Role = "admin" | "member";
type Pending = { clerkInvitationId: string; email: string; role: "org:admin" | "org:member" };
const clerkRole = (role: Role) => (role === "admin" ? "org:admin" : "org:member");

/** The most people one call invites: Clerk's bulk invitation takes 10. */
const INVITES_AT_ONCE = 10;

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

const FULL = "This organization has as many members as its plan allows, invitations included.";

/** What Clerk refused, in the person's words, with `invalid` for a request it found wrong; anything else is thrown as it is. */
function refused(error: unknown, invalid = "Clerk refused this change. Check the name or email and try again."): never {
  if (error instanceof ClerkApiError) {
    console.error("[organizations] Clerk refused", { status: error.status, code: error.code, traceId: error.traceId, message: error.message });
    if (error.code === "organization_membership_quota_exceeded" || error.code === "organization_membership_plan_quota_exceeded") {
      throw createError("VALIDATION_ERROR", FULL);
    }
    if (error.code === "duplicate_record" || error.code === "already_a_member_in_organization") throw createError("CONFLICT", "That person is already a member or invited.");
    if (error.status === 422 || error.status === 400) throw createError("VALIDATION_ERROR", invalid);
  }
  throw error;
}

async function clerk(key: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown, invalid?: string) {
  try {
    return (await clerkRequest(key, method, path, body)).body;
  } catch (error) {
    refused(error, invalid);
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

export const createAction = defineChangingAction({
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
    const organization = await createInClerk(key, requireName(name), clerkUserId);
    if (!isRecord(organization) || typeof organization.id !== "string") throw new Error("Clerk answered without the organization");
    await keep(ctx, key, "organization.created", organization);
    // Clerk makes its creator an admin; keep that membership too. Clerk's webhook brings it if this
    // read fails, and failing here would leave an organization made that the person retries.
    try {
      const memberships = await clerk(key, "GET", `/organizations/${organization.id}/memberships?user_id=${encodeURIComponent(clerkUserId)}&limit=1`);
      const mine = isRecord(memberships) && Array.isArray(memberships.data) ? memberships.data[0] : undefined;
      if (mine) await keep(ctx, key, "organizationMembership.created", mine);
    } catch (error) {
      console.error("[organizations] couldn't keep the new organization's admin; its webhook will", { clerkOrganizationId: organization.id, error: String(error) });
    }
    const made: { workspaceId: Id<"workspaces">; slug: string } | null = await ctx.runQuery(internal.organizations.read.workspaceOf, { clerkOrganizationId: organization.id });
    if (!made) throw new Error("The organization Clerk made isn't kept");
    return made;
  },
});
export const create = userAction(createAction);

/** The address an organization's name gives it: its letters and digits, lowercase, in words joined by hyphens. */
const slugOf = (name: string) =>
  name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "") || "organization";

/** Makes the organization in Clerk at the address its name gives it, or, when another has that, the same with a few letters after it. */
async function createInClerk(key: string, name: string, clerkUserId: string) {
  const slug = slugOf(name);
  for (let attempt = 0; ; attempt++) {
    try {
      return (await clerkRequest(key, "POST", "/organizations", { name, slug: attempt ? `${slug}-${crypto.randomUUID().slice(0, 4)}` : slug, created_by: clerkUserId })).body;
    } catch (error) {
      if (attempt < 3 && error instanceof ClerkApiError && error.code === "form_identifier_exists") continue;
      refused(error);
    }
  }
}
export const createForAssistant = assistantAction(createAction);

export const inviteAction = defineChangingAction({
  path: "organizations/manage:invite",
  description:
    `Invites people to the organization the person is in, by email, as admins or members; an admin of it does this. Clerk emails each a link to join. At most ${INVITES_AT_ONCE} at once. ` +
    `A free organization has up to ${FREE_MEMBERS} members, invitations included. On Team members, invitations and seats held to the renewal fill the seats bought (billing/seats:counts): ` +
    "with too few free, `addSeat` buys the seats missing first, charged to the organization's card for the days left to the renewal, and nothing is sent if the card is declined. Returns how many were invited.",
  args: { emails: v.array(v.string()), role: ROLE, addSeat: v.optional(v.boolean()) },
  returns: v.object({ invited: v.number() }),
  spendsCredits: false,
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor, { emails, role, addSeat }) => {
    const wanted = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
    if (wanted.length === 0 || wanted.length > INVITES_AT_ONCE) throw createError("VALIDATION_ERROR", `Invite 1 to ${INVITES_AT_ONCE} people at once.`);
    if (wanted.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw createError("VALIDATION_ERROR", "One of these isn't an email address.");
    const key = clerkSecretKey();
    const { clerkUserId, organization } = await inOrganization(ctx, actor, { adminOnly: true });
    // Clerk refuses a whole request for one address that's a member's or invited already: those are left out, and the rest go.
    const known: string[] = await ctx.runQuery(internal.organizations.read.alreadyIn, { workspaceId: actor.workspaceId, emails: wanted });
    const fresh = wanted.filter((email) => !known.includes(email));
    if (fresh.length === 0) throw createError("CONFLICT", wanted.length === 1 ? "That person is already a member or invited." : "These people are already members or invited.");
    // On Team, each invitation takes a seat (#863): the ones missing are bought first when asked for, and a declined card sends nothing.
    const counted: { members: number; invitations: number; seats: number; held: number } | null = await ctx.runQuery(internal.billing.seats.countsFor, { workspaceId: actor.workspaceId });
    const short = counted && counted.seats > 0 ? counted.members + counted.invitations + counted.held + fresh.length - counted.seats : 0;
    if (short > 0 && addSeat) {
      const confirm = await setSeats(ctx, actor.workspaceId, counted!.seats + short);
      if (confirm) throw createError("BILLING_PAYMENT_ACTION_REQUIRED", "The bank asks to confirm this charge. Confirm it, then send the invitation again.", { url: confirm });
    }
    return { invited: await sendInvitations(ctx, key, actor.workspaceId, clerkUserId, organization, fresh, clerkRole(role)) };
  },
});

/**
 * Has Clerk email each address a link to the organization's join page, and keeps the invitations.
 * Returns how many went out. Clerk counts for its limit as each request arrives, so requests made
 * at the same moment all pass it: once these are kept, the ones past the plan's room are taken
 * back, and the call is refused when that's all of them.
 */
async function sendInvitations(ctx: ActionCtx, key: string, workspaceId: Id<"workspaces">, clerkUserId: string, organization: { clerkOrganizationId: string; slug: string }, emails: string[], role: "org:admin" | "org:member") {
  const sent = await clerk(
    key,
    "POST",
    `/organizations/${organization.clerkOrganizationId}/invitations/bulk`,
    emails.map((email) => ({
      email_address: email,
      role,
      inviter_user_id: clerkUserId,
      redirect_url: `${requireAppUrl()}/join/${organization.slug}`,
      public_metadata: { inviterClerkUserId: clerkUserId },
    })),
  );
  const invitations = Array.isArray(sent) ? sent : isRecord(sent) && Array.isArray(sent.data) ? sent.data : [];
  for (const invitation of invitations) await keep(ctx, key, "organizationInvitation.created", invitation);
  const made = invitations.flatMap((invitation) => (isRecord(invitation) && typeof invitation.id === "string" ? [invitation.id] : []));
  const past: string[] = await ctx.runQuery(internal.organizations.read.pastRoom, { workspaceId, sent: made });
  for (const id of past) await takeBack(ctx, key, organization.clerkOrganizationId, id, clerkUserId);
  if (past.length && past.length === made.length) throw createError("VALIDATION_ERROR", FULL);
  return invitations.length - past.length;
}

/**
 * Takes back the invitations past the organization's room, as the admin `userId`: a move to Free
 * runs it once the move is made, for one sent while it was under way.
 */
export const trimInvitations = internalAction({
  args: { workspaceId: v.id("workspaces"), userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { workspaceId, userId }) => {
    const key = clerkSecretKey();
    const { clerkUserId, organization }: Context = await ctx.runQuery(internal.organizations.read.context, { userId, workspaceId });
    if (!organization) return null;
    // As many reads as clear a full organization; a move is crossed by a request or two.
    for (let step = 0; step < MAX_ORGANIZATION_MEMBERS / PAST_ROOM_STEP; step++) {
      const past: string[] = await ctx.runQuery(internal.organizations.read.pastRoom, { workspaceId });
      if (past.length === 0) break;
      for (const id of past) await takeBack(ctx, key, organization.clerkOrganizationId, id, clerkUserId);
    }
    return null;
  },
});

/** Takes back an invitation that hasn't been answered, and keeps that. */
async function takeBack(ctx: ActionCtx, key: string, clerkOrganizationId: string, clerkInvitationId: string, clerkUserId: string) {
  const revoked = await clerk(key, "POST", `/organizations/${clerkOrganizationId}/invitations/${clerkInvitationId}/revoke`, { requesting_user_id: clerkUserId });
  await keep(ctx, key, "organizationInvitation.revoked", revoked);
}
export const invite = userAction(inviteAction);
export const inviteForAssistant = assistantAction(inviteAction);

export const revokeInvitationAction = defineChangingAction({
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
    const { clerkInvitationId }: Pending = await ctx.runQuery(internal.organizations.read.pendingInvitation, { invitationId, organizationId: organization.organizationId });
    await takeBack(ctx, key, organization.clerkOrganizationId, clerkInvitationId, clerkUserId);
    return null;
  },
});
export const revokeInvitation = userAction(revokeInvitationAction);
export const revokeInvitationForAssistant = assistantAction(revokeInvitationAction);

export const declineInvitationAction = defineChangingAction({
  path: "organizations/manage:declineInvitation",
  description: "Declines an invitation the person was sent to join an organization (from organizations/queries:myInvitations). Its link stops working.",
  args: { invitationId: v.id("organizationInvitations") },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, { userId }, { invitationId }) => {
    const key = clerkSecretKey();
    const invitation: { clerkInvitationId: string; clerkOrganizationId: string } = await ctx.runQuery(internal.organizations.read.invitationFor, { invitationId, userId });
    const revoked = await clerk(key, "POST", `/organizations/${invitation.clerkOrganizationId}/invitations/${invitation.clerkInvitationId}/revoke`, {});
    await keep(ctx, key, "organizationInvitation.revoked", revoked);
    return null;
  },
});
export const declineInvitation = userAction(declineInvitationAction);
export const declineInvitationForAssistant = assistantAction(declineInvitationAction);

const SET_ROLE = "organizations/manage:setRole" as const;

export const setRoleAction = defineChangingAction({
  path: SET_ROLE,
  description:
    "Makes a member of the organization the person is in an admin or a member; an admin of it does this. Admins invite and remove members, change roles, and change the organization's settings. " +
    "An organization always keeps one admin. Returns `undo`, which puts the role back, unless the person made themselves a member, after which they can't change roles.",
  // `expect`, which an undo passes, is the role they should have now: one changed since refuses the undo.
  args: { userId: v.id("users"), role: ROLE, expect: v.optional(ROLE) },
  returns: v.object({ undo: reversedBy(SET_ROLE, { userId: v.id("users"), role: ROLE, expect: ROLE }) }),
  spendsCredits: false,
  // It changes what another person can do.
  outsideEffect: true,
  undoable: true,
  run: async (ctx, actor, { userId, role, expect }) => {
    const key = clerkSecretKey();
    const { clerkUserId, organization } = await inOrganization(ctx, actor, { adminOnly: true });
    const was = await memberRole(ctx, actor.workspaceId, userId);
    if (expect !== undefined && was !== expect) throw createError("CONFLICT", `Their role changed since: they're ${was === "admin" ? "an admin" : "a member"} now, and stay so.`);
    if (was === role) return {};
    const target = await changeMember(ctx, actor.workspaceId, clerkUserId, userId, clerkRole(role), async (target) => {
      const membership = await clerk(key, "PATCH", `/organizations/${organization.clerkOrganizationId}/memberships/${target}`, { role: clerkRole(role) });
      await keep(ctx, key, "organizationMembership.updated", membership);
    });
    // An admin who made themselves a member can't make anyone an admin again, themselves included.
    return target === clerkUserId ? {} : { undo: { path: SET_ROLE, args: { userId, role: was, expect: role } } };
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
  await changeMember(ctx, actor.workspaceId, clerkUserId, userId, "gone", async (target) => {
    const sentAt = Date.now();
    const membership = await clerk(key, "DELETE", `/organizations/${organization.clerkOrganizationId}/memberships/${target}`);
    await keep(ctx, key, "organizationMembership.deleted", membership, sentAt);
  });
}

/**
 * Makes a change to someone's place in the organization once it's allowed, and returns their
 * Clerk ID. One that takes an admin away holds its admins until it's kept, so the next sees it.
 */
async function changeMember(ctx: ActionCtx, workspaceId: Id<"workspaces">, clerkUserId: string, userId: Id<"users">, becomes: "org:admin" | "org:member" | "gone", change: (target: string) => Promise<void>): Promise<string> {
  const { target, heldAt }: { target: string; heldAt?: number } = await ctx.runMutation(internal.organizations.read.beginMemberChange, { workspaceId, actorClerkUserId: clerkUserId, userId, becomes });
  // A change that fails may still have been made in Clerk and not kept here: its hold runs out by itself, by when Clerk's webhook has brought it.
  await change(target);
  if (heldAt !== undefined) await ctx.runMutation(internal.organizations.read.endMemberChange, { workspaceId, heldAt });
  return target;
}

export const removeMemberAction = defineChangingAction({
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

export const leaveAction = defineChangingAction({
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

export const renameAction = defineChangingAction({
  path: "organizations/manage:rename",
  description: "Renames the organization the person is in; an admin of it does this. Returns `undo`, which puts the name back.",
  // `expect`, which an undo passes, is the name it should have now: a rename since refuses the undo.
  args: { name: nameArg, expect: v.optional(nameArg) },
  returns: v.object({ undo: reversedBy("organizations/manage:rename", { name: nameArg, expect: nameArg }) }),
  spendsCredits: false,
  // Every member sees the new name.
  outsideEffect: true,
  undoable: true,
  run: async (ctx, actor, { name, expect }) => {
    const key = clerkSecretKey();
    const { organization } = await inOrganization(ctx, actor, { adminOnly: true });
    if (expect !== undefined && organization.name !== expect) throw createError("CONFLICT", `The organization was renamed since: it's ${organization.name} now, and stays so.`);
    const renamed = requireName(name);
    if (renamed === organization.name) return {};
    const updated = await clerk(key, "PATCH", `/organizations/${organization.clerkOrganizationId}`, { name: renamed });
    await keep(ctx, key, "organization.updated", updated);
    return { undo: { path: "organizations/manage:rename" as const, args: { name: organization.name, expect: renamed } } };
  },
});
export const rename = userAction(renameAction);
export const renameForAssistant = assistantAction(renameAction);

export const deleteOrganizationAction = defineChangingAction({
  path: "organizations/manage:deleteOrganization",
  description:
    "Deletes the organization the person is in, and with it every member's access to its workspace; an admin of it does this, and it can't be undone. " +
    "It's refused while the organization has an Evidence Library, which has to be moved or deleted first. An organization on Team has its plan and seats ended first.",
  args: {},
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: true,
  undoable: false,
  // What would refuse it, read before the person is asked about it.
  check: async (ctx, { workspaceId, role }) => {
    if (role !== "admin") throw createError("FORBIDDEN", "Only an admin of the organization deletes it.");
    await deletable(ctx, workspaceId);
  },
  run: async (ctx, actor) => {
    const key = clerkSecretKey();
    const { organization } = await inOrganization(ctx, actor, { adminOnly: true });
    const deletingAt: number = await ctx.runMutation(internal.organizations.read.beginDeletion, { workspaceId: actor.workspaceId });
    const sentAt = Date.now();
    try {
      // A Team organization's plan and seats end first: Clerk deletes it only once Autumn shows neither (#652).
      await ctx.runAction(internal.billing.seats.endTeam, { workspaceId: actor.workspaceId });
      await clerk(key, "DELETE", `/organizations/${organization.clerkOrganizationId}`);
    } catch (error) {
      await ctx.runMutation(internal.organizations.read.endDeletion, { organizationId: organization.organizationId, deletingAt });
      throw error;
    }
    // Clerk has deleted it: it's closed here before anything else can fail.
    await ctx.runMutation(internal.organizations.read.deletedInClerk, { organizationId: organization.organizationId });
    try {
      await keep(ctx, key, "organization.deleted", { id: organization.clerkOrganizationId }, sentAt);
    } catch (error) {
      console.error("[organizations] couldn't keep a deletion; Clerk's webhook will end its memberships", { clerkOrganizationId: organization.clerkOrganizationId, error: String(error) });
    }
    return null;
  },
});
export const deleteOrganization = userAction(deleteOrganizationAction);
export const deleteOrganizationForAssistant = assistantAction(deleteOrganizationAction);

/**
 * Keeps the membership Clerk made when the person accepted an invitation in Clerk's own client
 * (#651), so the organization's pages open at once instead of after Clerk's webhook. Null when
 * Clerk has no membership of theirs there.
 */
export const confirmJoin = action({
  args: { slug: v.string() },
  returns: v.union(v.null(), v.object({ workspaceId: v.id("workspaces"), slug: v.string() })),
  handler: async (ctx, { slug }): Promise<{ workspaceId: Id<"workspaces">; slug: string } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw createError("UNAUTHENTICATED", "Sign in to join an organization");
    const clerkOrganizationId: string | null = await ctx.runQuery(internal.organizations.read.clerkIdOf, { slug });
    if (!clerkOrganizationId) return null;
    const key = clerkSecretKey();
    const memberships = await clerk(key, "GET", `/organizations/${clerkOrganizationId}/memberships?user_id=${encodeURIComponent(identity.subject)}&limit=1`);
    const mine = isRecord(memberships) && Array.isArray(memberships.data) ? memberships.data[0] : undefined;
    if (!mine) return null;
    await keep(ctx, key, "organizationMembership.created", mine);
    return await ctx.runQuery(internal.organizations.read.workspaceOf, { clerkOrganizationId });
  },
});

const SET_COLOUR = "organizations/manage:setColour" as const;
const colourArg = v.union(...ORGANIZATION_COLOURS.map((colour) => v.literal(colour)));

export const setColourAction = defineUserMutation({
  path: SET_COLOUR,
  description: `Sets the colour of the organization the person is in, which tints the sidebar for everyone while they're in it; an admin of it does this. One of ${ORGANIZATION_COLOURS.join(", ")}; without \`colour\`, it goes back to the one it started with. Returns \`undo\`, which puts the colour back.`,
  args: { colour: v.optional(colourArg) },
  returns: v.object({ undo: v.optional(reversedBy(SET_COLOUR, { colour: v.optional(colourArg) })) }),
  spendsCredits: false,
  outsideEffect: true,
  undoable: true,
  run: async (ctx, { workspaceId, role }, { colour }) => {
    if (role !== "admin") throw createError("FORBIDDEN", "Only an admin of the organization changes its colour.");
    const organization = await organizationOf(ctx, workspaceId);
    const was = organization.colour as OrganizationColour | undefined;
    if (was === colour) return {};
    await ctx.db.patch("organizations", organization._id, { colour });
    return { undo: { path: SET_COLOUR, args: was ? { colour: was } : {} } };
  },
});
export const setColour = userMutation(setColourAction);
export const setColourForAssistant = assistantMutation(setColourAction);

/**
 * Sets the AI preset the organization's work runs on: its screenings, extractions, helpers and
 * chats, for every member. An admin does this on the AI settings page; the assistant never does,
 * as it doesn't change the models it runs on.
 */
export const setAiPreset = workspaceMutation({
  args: { preset: presetKeyValidator },
  returns: v.null(),
  handler: async (ctx, { workspaceId, role }, { preset }) => {
    if (role !== "admin") throw createError("FORBIDDEN", "Only an admin of the organization changes its AI preset.");
    const organization = await organizationOf(ctx, workspaceId);
    if ((organization.aiPreset ?? DEFAULT_PRESET) !== preset) await ctx.db.patch("organizations", organization._id, { aiPreset: preset });
    return null;
  },
});

const RESEND = "organizations/manage:resendInvitation" as const;

export const resendInvitationAction = defineChangingAction({
  path: RESEND,
  description: "Sends an invitation to the organization the person is in again, as a new email with a new link; an admin of it does this. The one before stops working.",
  args: { invitationId: v.id("organizationInvitations") },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor, { invitationId }) => {
    const key = clerkSecretKey();
    const { clerkUserId, organization } = await inOrganization(ctx, actor, { adminOnly: true });
    const invitation: Pending = await ctx.runQuery(internal.organizations.read.pendingInvitation, { invitationId, organizationId: organization.organizationId });
    // Clerk can't send one again: it's taken back, which frees its seat, and a new one goes out to the same address.
    await takeBack(ctx, key, organization.clerkOrganizationId, invitation.clerkInvitationId, clerkUserId);
    await sendInvitations(ctx, key, actor.workspaceId, clerkUserId, organization, [invitation.email], invitation.role);
    return null;
  },
});
export const resendInvitation = userAction(resendInvitationAction);
export const resendInvitationForAssistant = assistantAction(resendInvitationAction);

/** The most a logo may weigh. */
const LOGO_BYTES = 5 * 1024 * 1024;

/**
 * Sets the logo of the organization the person is in, from an image they picked in their
 * browser; an admin of it does this. Clerk keeps it and serves it to everyone.
 */
export const setLogo = action({
  args: { workspaceId: v.id("workspaces"), image: v.bytes(), contentType: v.string() },
  returns: v.null(),
  handler: async (ctx, { workspaceId, image, contentType }) => {
    if (!contentType.startsWith("image/")) throw createError("VALIDATION_ERROR", "A logo is an image.");
    if (image.byteLength > LOGO_BYTES) throw createError("VALIDATION_ERROR", "A logo is at most 5 MB.");
    const actor: Actor = await ctx.runQuery(internal.workspaces.actor.signedInActor, { workspaceId });
    const key = clerkSecretKey();
    const { clerkUserId, organization } = await inOrganization(ctx, { ...actor, author: "user" }, { adminOnly: true });
    const form = new FormData();
    form.append("file", new Blob([image], { type: contentType }), "logo");
    form.append("uploader_user_id", clerkUserId);
    const body = await clerk(key, "PUT", `/organizations/${organization.clerkOrganizationId}/logo`, form, "That file couldn't be read as an image. Pick a PNG, JPEG, WebP or GIF.");
    await keep(ctx, key, "organization.updated", body);
    return null;
  },
});
