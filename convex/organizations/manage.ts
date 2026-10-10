// Organizations in OpenScholar (#651): making one, its members, invitations and roles, leaving
// and deleting. Each change is Clerk's: these actions call its Backend API, then keep what it
// answered as its webhook would (convex/webhooks/clerk.ts), so a page needn't wait for the
// webhook. Clerk's own event for the same change applies again, or is older and skipped.

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, type ActionCtx } from "../_generated/server";
import { ClerkApiError, clerkRequest, clerkSecretKey, isRecord } from "../lib/clerk";
import { requireAppUrl } from "../lib/env";
import { createError } from "../lib/errors";
import { assistantAction, assistantMutation, defineChangingAction, defineUserMutation, reversedBy, userAction, userMutation, type Acting } from "../lib/userActions";
import { processClerkWebhookEvent } from "../webhooks/clerk";
import { ORGANIZATION_COLOURS, type OrganizationColour } from "../../lib/workspaces/colours";
import { deletable, organizationOf } from "./read";
import { presetKeyValidator } from "../aiModelConfig/validators";
import { DEFAULT_PRESET, PRESET_KEYS } from "../../lib/ai/tasks";
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

async function clerk(key: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown) {
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
    "A free organization has up to 5 members, invitations included; one on Team has no limit. Returns how many were invited.",
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
    return { invited: await sendInvitations(ctx, key, clerkUserId, organization, wanted, clerkRole(role)) };
  },
});

/** Has Clerk email each address a link to the organization's join page, and keeps the invitations. Returns how many went out. */
async function sendInvitations(ctx: ActionCtx, key: string, clerkUserId: string, organization: { clerkOrganizationId: string; slug: string }, emails: string[], role: "org:admin" | "org:member") {
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
  return invitations.length;
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
    const revoked = await clerk(key, "POST", `/organizations/${organization.clerkOrganizationId}/invitations/${clerkInvitationId}/revoke`, { requesting_user_id: clerkUserId });
    await keep(ctx, key, "organizationInvitation.revoked", revoked);
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

export const setRoleAction = defineChangingAction({
  path: SET_ROLE,
  description:
    "Makes a member of the organization the person is in an admin or a member; an admin of it does this. Admins invite and remove members, change roles, and change the organization's settings. " +
    "An organization always keeps one admin. Returns `undo`, which puts the role back, unless the person made themselves a member, after which they can't change roles.",
  args: { userId: v.id("users"), role: ROLE },
  returns: v.object({ undo: reversedBy(SET_ROLE, { userId: v.id("users"), role: ROLE }) }),
  spendsCredits: false,
  // It changes what another person can do.
  outsideEffect: true,
  undoable: true,
  run: async (ctx, actor, { userId, role }) => {
    const key = clerkSecretKey();
    const { clerkUserId, organization } = await inOrganization(ctx, actor, { adminOnly: true });
    const was = await memberRole(ctx, actor.workspaceId, userId);
    if (was === role) return {};
    const target: string = await ctx.runQuery(internal.organizations.read.checkMemberChange, { workspaceId: actor.workspaceId, actorClerkUserId: clerkUserId, actorIsAdmin: true, userId, becomes: clerkRole(role) });
    const membership = await clerk(key, "PATCH", `/organizations/${organization.clerkOrganizationId}/memberships/${target}`, { role: clerkRole(role) });
    await keep(ctx, key, "organizationMembership.updated", membership);
    // An admin who made themselves a member can't make anyone an admin again, themselves included.
    return target === clerkUserId ? {} : { undo: { path: SET_ROLE, args: { userId, role: was } } };
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
  args: { name: nameArg },
  returns: v.object({ undo: reversedBy("organizations/manage:rename", { name: nameArg }) }),
  spendsCredits: false,
  // Every member sees the new name.
  outsideEffect: true,
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

const SET_AI_PRESET = "organizations/manage:setAiPreset" as const;

export const setAiPresetAction = defineUserMutation({
  path: SET_AI_PRESET,
  description: `Sets the AI preset the work of the organization the person is in runs on: its screenings, extractions, helpers and chats, for every member; an admin of it does this. One of ${PRESET_KEYS.join(", ")}. Returns \`undo\`, which puts the preset back.`,
  args: { preset: presetKeyValidator },
  returns: v.object({ undo: v.optional(reversedBy(SET_AI_PRESET, { preset: presetKeyValidator })) }),
  spendsCredits: false,
  outsideEffect: true,
  undoable: true,
  run: async (ctx, { workspaceId, role }, { preset }) => {
    if (role !== "admin") throw createError("FORBIDDEN", "Only an admin of the organization changes its AI preset.");
    const organization = await organizationOf(ctx, workspaceId);
    const was = organization.aiPreset ?? DEFAULT_PRESET;
    if (was === preset) return {};
    await ctx.db.patch("organizations", organization._id, { aiPreset: preset });
    return { undo: { path: SET_AI_PRESET, args: { preset: was } } };
  },
});
export const setAiPreset = userMutation(setAiPresetAction);
export const setAiPresetForAssistant = assistantMutation(setAiPresetAction);

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
    const revoked = await clerk(key, "POST", `/organizations/${organization.clerkOrganizationId}/invitations/${invitation.clerkInvitationId}/revoke`, { requesting_user_id: clerkUserId });
    await keep(ctx, key, "organizationInvitation.revoked", revoked);
    await sendInvitations(ctx, key, clerkUserId, organization, [invitation.email], invitation.role);
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
    const body = await clerk(key, "PUT", `/organizations/${organization.clerkOrganizationId}/logo`, form);
    await keep(ctx, key, "organization.updated", body);
    return null;
  },
});
