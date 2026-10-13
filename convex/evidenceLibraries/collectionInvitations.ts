/**
 * Invitations to a reader's collection in an Evidence Library (EL-26, #893). The library keeps
 * its readers' collections and who may use them, and no addresses. OpenScholar keeps the
 * invitations, emails them in the library's name, and checks with Clerk that whoever accepts
 * has the invited address. Only the library's own page accepts them, so OpenScholar's sharing
 * pages and invitation lists leave them out (../sharing/items.ts `shares`).
 *
 * The library asks with its machine credential, for one reader named by their Clerk user ID,
 * with `contractVersion: 1`, at `/api/v1/evidence-libraries/collection-invitations/<call>`:
 *
 * - `invite` {collectionId, collectionName, email, role}: keeps an invitation and emails it, or
 *   sends one to the same address again. Answers with it as `list` shows it. One of the reader's own
 *   addresses is refused: the collection is theirs already.
 * - `list`: the reader's invitations still waiting, to their collections in this library.
 * - `change` {invitationId, role | cancel | resend with collectionId and collectionName}: one of the reader's
 *   waiting invitations. Sending again uses the collection's name as it is now.
 * - `cancel` {collectionId}: every waiting invitation to a collection being deleted.
 * - `read` {invitationId}: what its page may show this reader.
 * - `respond` {invitationId, accept}: accepts or declines it, for an account with the invited
 *   address verified. Accepted, it answers the collection and role; accepting again answers the same.
 *
 * A refusal answers `{error}` with one of the codes the library tells its readers about.
 */
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { httpAction, type ActionCtx, type QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../lib/functions";
import { createError, readConvexErrorData } from "../lib/errors";
import { jsonResponse, readBearerCredential } from "../lib/libraryServiceHttp";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { addressesOf, personName } from "../lib/people";
import { MAX_PENDING_COLLECTION_INVITATIONS_PER_READER, MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL } from "../lib/queryBounds";
import { rateLimit } from "../lib/rateLimit";
import { invitationTo } from "../sharing/access";
import { guestRoleValidator, type GuestRole } from "../sharing/validators";
import { findMatchingLibraryServiceCredential } from "./credentials";
import { libraryEmailSender } from "./invitations";

const WEEK = 7 * 86_400_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REFUSALS = ["invalid_email", "own_address", "rate_limited", "too_many_invitations", "not_found", "answered", "expired", "other_address"] as const;
type Refusal = (typeof REFUSALS)[number];
const refusedValidator = v.object({ refused: v.union(...REFUSALS.map((refusal) => v.literal(refusal))) });
const REFUSAL_STATUS: Record<Refusal, number> = {
  invalid_email: 400, own_address: 400, rate_limited: 429, too_many_invitations: 409, not_found: 404, answered: 409, expired: 410, other_address: 403,
};
const refused = (refusal: Refusal) => ({ refused: refusal });

/** Who asks: the library its credential is for, and the reader it asks for by their Clerk user ID. */
const callerArgs = { libraryId: v.string(), clerkUserId: v.string(), credentialDigest: v.string() };
type Caller = { libraryId: string; clerkUserId: string; credentialDigest: string };

/** The library and the reader asking, who must have an account here that's in use. */
async function callerOf(ctx: Pick<QueryCtx, "db">, caller: Caller) {
  const libraryId = ctx.db.normalizeId("evidenceLibraries", caller.libraryId);
  if (!libraryId || !(await findMatchingLibraryServiceCredential(ctx, { libraryId, credentialDigest: caller.credentialDigest }))) {
    throw createError("UNAUTHENTICATED", "Invalid library service credential");
  }
  const [library, reader] = await Promise.all([
    ctx.db.get("evidenceLibraries", libraryId),
    ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", caller.clerkUserId)).unique(),
  ]);
  if (!library || library.state === "disabled" || reader?.state !== "active") throw createError("FORBIDDEN", "This reader or library can't use invitations");
  return { library, reader };
}

/** A collection as OpenScholar names it: its library's ID and its own, which only the library can read. */
const itemOf = (libraryId: Id<"evidenceLibraries">, collectionId: string) => `${libraryId}:${collectionId}`;
const collectionIdOf = (invitation: Doc<"itemInvitations">) => invitation.item.slice(invitation.item.indexOf(":") + 1);
const roleOf = (invitation: Doc<"itemInvitations">) => invitation.role as GuestRole;
const waiting = (invitation: Doc<"itemInvitations">) => invitation.state === "pending" && invitation.expiresAt > Date.now();

/**
 * One of this library's collection invitations by its ID, as the library sent it. One whose
 * sender's account was deleted is gone at once, before its cancellation (`cancelSentBy`) runs.
 */
async function invitationIn(ctx: Pick<QueryCtx, "db">, library: Doc<"evidenceLibraries">, invitationId: string) {
  const id = ctx.db.normalizeId("itemInvitations", invitationId);
  const invitation = id ? await ctx.db.get("itemInvitations", id) : null;
  if (invitation?.kind !== "libraryCollection" || !invitation.item.startsWith(`${library._id}:`)) return null;
  return (await ctx.db.get("users", invitation.invitedBy))?.state === "active" ? invitation : null;
}

const sentValidator = v.object({
  id: v.string(), collectionId: v.string(), email: v.string(), role: guestRoleValidator,
  delivery: v.union(v.literal("queued"), v.literal("sent"), v.literal("failed")), sentAt: v.number(), expiresAt: v.number(),
});
/** An invitation as the reader who sent it sees it. Sending it again restarts its seven days, so it was last sent a week before it expires. */
const sentView = (invitation: Doc<"itemInvitations">) => ({
  id: invitation._id, collectionId: collectionIdOf(invitation), email: invitation.email, role: roleOf(invitation),
  delivery: invitation.delivery, sentAt: invitation.expiresAt - WEEK, expiresAt: invitation.expiresAt,
});

/**
 * When a send's invitation expires, which also names that send for its delivery (`recordDelivery`): seven days from
 * now, and always later than the send before it, even one in the same millisecond.
 */
const sendExpiry = (previous?: number) => Math.max(Date.now() + WEEK, (previous ?? 0) + 1);

/** The reader's waiting invitations to collections in any library, which inviting keeps to MAX_PENDING_COLLECTION_INVITATIONS_PER_READER. */
const sentBy = (ctx: Pick<QueryCtx, "db">, readerId: Id<"users">) =>
  ctx.db.query("itemInvitations").withIndex("by_invitedBy_and_kind_and_state", (q) => q.eq("invitedBy", readerId).eq("kind", "libraryCollection").eq("state", "pending"))
    .take(MAX_PENDING_COLLECTION_INVITATIONS_PER_READER);

/**
 * Keeps an invitation, ready to email. One still waiting at the same address and collection is the same row: sending
 * it again restarts its seven days and takes no second place. One answered, cancelled or expired is replaced by a new
 * row with a new ID, since the library makes a member once per invitation ID and the owner may have ended that since.
 */
export const prepare = internalMutation({
  args: { ...callerArgs, collectionId: v.string(), collectionName: v.string(), email: v.string(), role: guestRoleValidator },
  returns: v.union(v.object({ invitation: sentValidator }), refusedValidator),
  handler: async (ctx, { collectionId, collectionName, role, ...args }) => {
    const { library, reader } = await callerOf(ctx, args);
    const email = args.email.trim().toLowerCase();
    if (email.length > 254 || !EMAIL.test(email)) return refused("invalid_email");
    if (addressesOf(reader).includes(email)) return refused("own_address");
    if (!(await rateLimit(ctx, { name: "item-invitation", key: String(reader._id) })).ok) return refused("rate_limited");
    const item = itemOf(library._id, collectionId);
    const found = await invitationTo(ctx, item, email);
    const existing = found?.state === "pending" ? found : null;
    if (!existing) {
      const [sent, theirs] = await Promise.all([
        sentBy(ctx, reader._id),
        ctx.db.query("itemInvitations").withIndex("by_email_and_state", (q) => q.eq("email", email).eq("state", "pending")).take(MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL),
      ]);
      if (sent.length >= MAX_PENDING_COLLECTION_INVITATIONS_PER_READER || theirs.length >= MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL) return refused("too_many_invitations");
    }
    const values = { kind: "libraryCollection" as const, item, name: collectionName, email, role, invitedBy: reader._id, expiresAt: sendExpiry(existing?.expiresAt), state: "pending" as const, delivery: "queued" as const };
    if (found && !existing) await ctx.db.delete("itemInvitations", found._id);
    const invitationId = existing?._id ?? (await ctx.db.insert("itemInvitations", values));
    if (existing) await ctx.db.replace("itemInvitations", existing._id, values);
    // Its time up, it is marked expired, so lists filter on its state (../sharing/invitations.ts).
    await ctx.scheduler.runAt(values.expiresAt, internal.sharing.invitations.expire, { invitationId });
    return { invitation: sentView({ ...values, _id: invitationId, _creationTime: existing?._creationTime ?? Date.now() }) };
  },
});

/**
 * What an invitation's email says and where it links. Null once it no longer waits, its sender's account or its
 * library is gone, or the library has no address to link to: the email would lead nowhere.
 */
export const readDelivery = internalQuery({
  args: { invitationId: v.id("itemInvitations") },
  returns: v.union(v.null(), v.object({
    email: v.string(), collectionName: v.string(), role: guestRoleValidator, inviter: v.string(), libraryName: v.string(), acceptUrl: v.string(),
    contactEmail: v.union(v.string(), v.null()),
    emailIdentity: v.object({ name: v.string(), baseUrl: v.union(v.string(), v.null()), logoUrl: v.string(), accent: v.string() }),
  })),
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get("itemInvitations", invitationId);
    if (invitation?.kind !== "libraryCollection" || !waiting(invitation)) return null;
    const libraryId = ctx.db.normalizeId("evidenceLibraries", invitation.item.slice(0, invitation.item.indexOf(":")));
    const library = libraryId ? await ctx.db.get("evidenceLibraries", libraryId) : null;
    const binding = library?.runtimeBindingId ? await ctx.db.get("evidenceLibraryRuntimeBindings", library.runtimeBindingId) : null;
    const inviter = await ctx.db.get("users", invitation.invitedBy);
    const address = binding?.canonicalBaseUrl ?? binding?.targetBaseUrl;
    if (!library || library.state === "disabled" || !address || inviter?.state !== "active") return null;
    return {
      email: invitation.email, collectionName: invitation.name ?? "", role: roleOf(invitation), inviter: personName(inviter) || inviter.email,
      libraryName: library.name, acceptUrl: new URL(`/invitations/${invitation._id}`, address).href, ...(await libraryEmailSender(ctx, library)),
    };
  },
});

/** The reader's invitations still waiting, to their collections in this library, last sent first. */
export const list = internalQuery({
  args: callerArgs,
  returns: v.array(sentValidator),
  handler: async (ctx, args) => {
    const { library, reader } = await callerOf(ctx, args);
    const inLibrary = (await sentBy(ctx, reader._id)).filter((invitation) => invitation.item.startsWith(`${library._id}:`) && waiting(invitation));
    return inLibrary.sort((a, b) => b.expiresAt - a.expiresAt).map(sentView);
  },
});

/**
 * Changes the role one of the reader's waiting invitations gives, cancels it, or readies it to send again. Sending
 * again names its collection, which must be the one it is to, with the name the collection has now for the email;
 * it answers the new send's attempt, which its delivery is recorded for.
 */
export const change = internalMutation({
  args: {
    ...callerArgs, invitationId: v.string(), role: v.optional(guestRoleValidator), cancel: v.optional(v.literal(true)),
    resend: v.optional(v.object({ collectionId: v.string(), collectionName: v.string() })),
  },
  returns: v.union(v.object({ sendAttempt: v.union(v.number(), v.null()) }), refusedValidator),
  handler: async (ctx, { invitationId, role, resend, cancel, ...args }) => {
    const { library, reader } = await callerOf(ctx, args);
    const invitation = await invitationIn(ctx, library, invitationId);
    if (!invitation || invitation.invitedBy !== reader._id || !waiting(invitation)) return refused("not_found");
    if (cancel) await ctx.db.patch("itemInvitations", invitation._id, { state: "cancelled" });
    else if (resend) {
      if (invitation.item !== itemOf(library._id, resend.collectionId)) return refused("not_found");
      if (!(await rateLimit(ctx, { name: "item-invitation", key: String(reader._id) })).ok) return refused("rate_limited");
      const expiresAt = sendExpiry(invitation.expiresAt);
      await ctx.db.patch("itemInvitations", invitation._id, { expiresAt, delivery: "queued", name: resend.collectionName });
      await ctx.scheduler.runAt(expiresAt, internal.sharing.invitations.expire, { invitationId: invitation._id });
      return { sendAttempt: expiresAt };
    } else if (role) await ctx.db.patch("itemInvitations", invitation._id, { role });
    return { sendAttempt: null };
  },
});

/**
 * Keeps whether a send went. Each send restarts the invitation's seven days, so its expiry names
 * the attempt: a slower earlier send that finishes after a later one changes nothing.
 */
export const recordDelivery = internalMutation({
  args: { invitationId: v.id("itemInvitations"), attempt: v.number(), delivery: v.union(v.literal("sent"), v.literal("failed")) },
  returns: v.null(),
  handler: async (ctx, { invitationId, attempt, delivery }) => {
    const invitation = await ctx.db.get("itemInvitations", invitationId);
    if (invitation?.state === "pending" && invitation.expiresAt === attempt) await ctx.db.patch("itemInvitations", invitationId, { delivery });
    return null;
  },
});

/** Cancels the reader's waiting invitations to one of their collections, which the library is deleting. */
export const cancel = internalMutation({
  args: { ...callerArgs, collectionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { collectionId, ...args }) => {
    const { library, reader } = await callerOf(ctx, args);
    const item = itemOf(library._id, collectionId);
    // Only its owner invites to a collection, so its waiting invitations are some of theirs.
    const rows = await ctx.db.query("itemInvitations").withIndex("by_item_and_state", (q) => q.eq("item", item).eq("state", "pending")).take(MAX_PENDING_COLLECTION_INVITATIONS_PER_READER);
    for (const row of rows) if (row.invitedBy === reader._id) await ctx.db.patch("itemInvitations", row._id, { state: "cancelled" });
    return null;
  },
});

/**
 * What an invitation's page may show the reader: `gone` once it can't be taken up by them, and
 * `other` to an account whose addresses don't include the one it went to, which learns nothing
 * of it, as the link may have been passed on (../sharing/invitations.ts `get`). It may still
 * accept, if Clerk has that address verified on the account.
 */
export const read = internalQuery({
  args: { ...callerArgs, invitationId: v.string() },
  returns: v.union(
    v.object({ state: v.union(v.literal("gone"), v.literal("other")) }),
    v.object({ state: v.union(v.literal("pending"), v.literal("accepted")), collectionId: v.string(), role: guestRoleValidator }),
  ),
  handler: async (ctx, { invitationId, ...args }) => {
    const { library, reader } = await callerOf(ctx, args);
    const invitation = await invitationIn(ctx, library, invitationId);
    const acceptedByReader = invitation?.state === "accepted" && invitation.acceptedBy === reader._id;
    if (!invitation || !(acceptedByReader || waiting(invitation))) return { state: "gone" as const };
    if (!acceptedByReader && !addressesOf(reader).includes(invitation.email)) return { state: "other" as const };
    return { state: acceptedByReader ? ("accepted" as const) : ("pending" as const), collectionId: collectionIdOf(invitation), role: roleOf(invitation) };
  },
});

/** Checks the library's credential and the reader before anything asks Clerk about them. */
export const check = internalQuery({
  args: callerArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await callerOf(ctx, args);
    return null;
  },
});

/** Answers an invitation for the reader, whose verified addresses Clerk gave as `emails`. */
export const respondVerified = internalMutation({
  args: { ...callerArgs, invitationId: v.string(), emails: v.array(v.string()), accept: v.boolean() },
  returns: v.union(v.object({ collectionId: v.string(), role: guestRoleValidator }), v.object({ declined: v.literal(true) }), refusedValidator),
  handler: async (ctx, { invitationId, emails, accept, ...args }) => {
    const { library, reader } = await callerOf(ctx, args);
    const invitation = await invitationIn(ctx, library, invitationId);
    if (!invitation || invitation.state === "cancelled") return refused("not_found");
    const accepted = { collectionId: collectionIdOf(invitation), role: roleOf(invitation) };
    // Accepting again, as a retry after the library's own write failed does, answers the same.
    if (invitation.state === "accepted" && invitation.acceptedBy === reader._id) return accept ? accepted : refused("answered");
    if (!emails.includes(invitation.email)) return refused("other_address");
    if (invitation.state === "expired" || (invitation.state === "pending" && invitation.expiresAt <= Date.now())) return refused("expired");
    if (invitation.state !== "pending") return refused("answered");
    await ctx.db.patch("itemInvitations", invitation._id, accept ? { state: "accepted", acceptedBy: reader._id } : { state: "declined" });
    return accept ? accepted : { declined: true as const };
  },
});

/** A step of a deleted account's waiting invitations to its collections, cancelled so nobody takes them up; the next step follows while any are left. */
export const cancelSentBy = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const rows = await sentBy(ctx, userId);
    for (const row of rows) await ctx.db.patch("itemInvitations", row._id, { state: "cancelled" });
    if (rows.length === MAX_PENDING_COLLECTION_INVITATIONS_PER_READER) await ctx.scheduler.runAfter(0, internal.evidenceLibraries.collectionInvitations.cancelSentBy, { userId });
    return null;
  },
});

const callerBody = z.object({ contractVersion: z.literal(1), libraryId: z.string().min(1).max(128), clerkUserId: z.string().min(1).max(512) });
const invitationBody = callerBody.extend({ invitationId: z.string().min(1).max(128) });
const roleBody = z.enum(["viewer", "editor"]);

/** Emails a waiting invitation for one send; what came of it, `sent` or `failed`, is kept on it and answered. */
const deliver = (ctx: ActionCtx, invitationId: string, attempt: number): Promise<"sent" | "failed"> =>
  ctx.runAction(internal.evidenceLibraries.collectionInvitationMail.deliver, { invitationId: invitationId as Id<"itemInvitations">, attempt });

const answer = (result: object) => ("refused" in result ? jsonResponse(REFUSAL_STATUS[result.refused as Refusal], { error: result.refused }) : jsonResponse(200, result as Record<string, unknown>));

/** Each call: what its body holds besides the caller, and how it's answered. */
const CALLS = {
  invite: {
    body: callerBody.extend({ collectionId: z.uuid(), collectionName: z.string().trim().min(1).max(500), email: z.string().max(1024), role: roleBody }),
    run: async (ctx: ActionCtx, caller: Caller, { collectionId, collectionName, email, role }: { collectionId: string; collectionName: string; email: string; role: GuestRole }) => {
      const prepared = await ctx.runMutation(internal.evidenceLibraries.collectionInvitations.prepare, { ...caller, collectionId, collectionName, email, role });
      if ("refused" in prepared) return answer(prepared);
      return answer({ ...prepared.invitation, delivery: await deliver(ctx, prepared.invitation.id, prepared.invitation.expiresAt) });
    },
  },
  list: {
    body: callerBody,
    run: async (ctx: ActionCtx, caller: Caller) => answer({ invitations: await ctx.runQuery(internal.evidenceLibraries.collectionInvitations.list, caller) }),
  },
  change: {
    body: z.union([
      invitationBody.extend({ role: roleBody }).strict(),
      invitationBody.extend({ resend: z.literal(true), collectionId: z.uuid(), collectionName: z.string().trim().min(1).max(500) }).strict(),
      invitationBody.extend({ cancel: z.literal(true) }).strict(),
    ]),
    run: async (
      ctx: ActionCtx,
      caller: Caller,
      { invitationId, role, cancel, resend, collectionId, collectionName }: { invitationId: string; role?: GuestRole; cancel?: true; resend?: true; collectionId?: string; collectionName?: string },
    ) => {
      // The body is one of the three, so exactly one of these is there.
      const change = resend && collectionId && collectionName ? { resend: { collectionId, collectionName } } : cancel ? { cancel } : role ? { role } : {};
      const changed = await ctx.runMutation(internal.evidenceLibraries.collectionInvitations.change, { ...caller, invitationId, ...change });
      if ("refused" in changed) return answer(changed);
      if (changed.sendAttempt !== null) await deliver(ctx, invitationId, changed.sendAttempt);
      return answer({});
    },
  },
  cancel: {
    body: callerBody.extend({ collectionId: z.uuid() }),
    run: async (ctx: ActionCtx, caller: Caller, { collectionId }: { collectionId: string }) =>
      answer(await ctx.runMutation(internal.evidenceLibraries.collectionInvitations.cancel, { ...caller, collectionId }) ?? {}),
  },
  read: {
    body: invitationBody,
    run: async (ctx: ActionCtx, caller: Caller, { invitationId }: { invitationId: string }) =>
      answer(await ctx.runQuery(internal.evidenceLibraries.collectionInvitations.read, { ...caller, invitationId })),
  },
  respond: {
    body: invitationBody.extend({ accept: z.boolean() }),
    run: async (ctx: ActionCtx, caller: Caller, { invitationId, accept }: { invitationId: string; accept: boolean }) => {
      await ctx.runQuery(internal.evidenceLibraries.collectionInvitations.check, caller);
      const emails: string[] = await ctx.runAction(internal.sharing.mail.verifiedEmails, { clerkUserId: caller.clerkUserId });
      const answered = await ctx.runMutation(internal.evidenceLibraries.collectionInvitations.respondVerified, { ...caller, invitationId, emails, accept });
      return answer("declined" in answered ? {} : answered);
    },
  },
};
export type CollectionInvitationCall = keyof typeof CALLS;
export const COLLECTION_INVITATION_CALLS = Object.keys(CALLS) as CollectionInvitationCall[];

/** The HTTP action for one call, at `/api/v1/evidence-libraries/collection-invitations/<call>` (../http.ts). */
export const serveCollectionInvitations = (call: CollectionInvitationCall) =>
  httpAction(async (ctx, request) => {
    const credential = readBearerCredential(request);
    if (!credential) return jsonResponse(401, { error: "invalid_service_credential" });
    const body = CALLS[call].body.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonResponse(400, { error: "invalid_request" });
    const { contractVersion: _, libraryId, clerkUserId, ...input } = body.data;
    const caller = { libraryId, clerkUserId, credentialDigest: await digestOpaqueToken(credential) };
    try {
      return await (CALLS[call].run as (ctx: ActionCtx, caller: Caller, input: object) => Promise<Response>)(ctx, caller, input);
    } catch (error) {
      const code = readConvexErrorData(error)?.code;
      if (code === "UNAUTHENTICATED") return jsonResponse(401, { error: "invalid_service_credential" });
      if (code === "FORBIDDEN") return jsonResponse(403, { error: "reader_unavailable" });
      console.error("Collection invitation call failed", { call, libraryId, error });
      return jsonResponse(503, { error: "collection_invitations_unavailable" });
    }
  });
