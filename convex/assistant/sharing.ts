/**
 * Sharing an assistant chat (#324). Its owner lets a person or an organization in, to read
 * or to write. Sharing shares the conversation only: the searches, collections, jobs and
 * libraries in it keep their own access, and the assistant acts for whoever sends a
 * message, with that person's access and credits.
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireFeature } from "../featureFlags/guard";
import { createError } from "../lib/errors";
import { MAX_ASSISTANT_THREAD_GRANTS } from "../lib/queryBounds";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, userMutation, userQuery } from "../lib/userActions";
import { readMemberOrganizations } from "../organizationFeatures";
import schema from "../schema";
import { accessRow, accessRows, personName, principalKey, principalOf, requireThread, type AssistantPrincipal } from "./access";
import { ASSISTANT_CANDIDATES_SHOWN, assistantCandidatesValidator, assistantGrantRoleValidator, assistantPrincipalValidator, assistantRoleValidator } from "./validators";

const FLAG = "assistant.enabled";
const ACCESS_PAGE_MAX = 50;
/** Organization members one suggestion read looks through for the ones the text matches. */
const CANDIDATE_ROWS = 500;
/** An organization's size is counted this far; past it the sheet says "100+". */
const MEMBERS_COUNTED = 100;

/** The owner's active organizations, by ID. */
async function organizationsOf(ctx: QueryCtx | MutationCtx, user: Doc<"users">) {
  return new Map((await readMemberOrganizations(ctx, user)).map(({ organization }) => [organization._id, organization]));
}

/**
 * Refuses a principal the owner can't share with. A person must be an active account in one
 * of the owner's organizations, and an organization must be one the owner is in, so a chat
 * is never shared with a stranger by ID.
 */
async function shareable(ctx: MutationCtx, owner: Doc<"users">, principal: AssistantPrincipal) {
  const mine = await organizationsOf(ctx, owner);
  if (principal.kind === "organization") {
    if (!mine.has(principal.organizationId)) throw createError("FORBIDDEN", "You can share a chat with an organization you belong to.");
    return;
  }
  if (principal.userId === owner._id) throw createError("VALIDATION_ERROR", "This chat is already yours.");
  const person = await ctx.db.get("users", principal.userId);
  const theirs = person?.state === "active" ? await organizationsOf(ctx, person) : new Map<Id<"organizations">, unknown>();
  if (![...theirs.keys()].some((organizationId) => mine.has(organizationId))) {
    throw createError("FORBIDDEN", "You can share a chat with people in your organizations.");
  }
}

export const grantAction = defineUserMutation({
  path: "assistant/sharing:grant",
  description:
    "Shares an assistant chat with a person or with everyone in an organization, to read it (`read`) or to send messages in it too (`write`), or changes what they may do. " +
    "Only the chat's owner can. They see the conversation; the searches, collections, jobs and libraries in it keep their own access.",
  args: { threadId: v.id("assistantThreads"), principal: assistantPrincipalValidator, role: assistantGrantRoleValidator },
  returns: v.null(),
  spendsCredits: false,
  // Someone else gains access to the conversation.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, userId, { threadId, principal, role }) => {
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId, "owner");
    const owner = await ctx.db.get("users", userId);
    if (!owner) throw createError("NOT_FOUND", "Chat not found");
    await shareable(ctx, owner, principal);
    const key = principalKey(principal);
    const existing = await accessRow(ctx, threadId, key);
    if (existing) {
      if (existing.role !== role) await ctx.db.patch("assistantThreadAccess", existing._id, { role });
      return null;
    }
    // The owner's row is one of these.
    if ((await accessRows(ctx, threadId)).length > MAX_ASSISTANT_THREAD_GRANTS) {
      throw createError("VALIDATION_ERROR", `A chat can be shared with up to ${MAX_ASSISTANT_THREAD_GRANTS} people and organizations. Remove one to add another.`);
    }
    await ctx.db.insert("assistantThreadAccess", { threadId, principal: key, role, lastMessageAt: thread.lastMessageAt, createdAt: Date.now() });
    return null;
  },
});
export const grant = userMutation(grantAction);
export const grantForAssistant = assistantMutation(grantAction);

export const revokeAction = defineUserMutation({
  path: "assistant/sharing:revoke",
  description: "Stops sharing an assistant chat with a person or an organization. Only the chat's owner can.",
  args: { threadId: v.id("assistantThreads"), principal: assistantPrincipalValidator },
  returns: v.null(),
  spendsCredits: false,
  // Someone else loses access to the conversation.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, userId, { threadId, principal }) => {
    await requireFeature(ctx, FLAG, userId);
    await requireThread(ctx, userId, threadId, "owner");
    const row = await accessRow(ctx, threadId, principalKey(principal));
    if (row && row.role !== "owner") await ctx.db.delete("assistantThreadAccess", row._id);
    return null;
  },
});
export const revoke = userMutation(revokeAction);
export const revokeForAssistant = assistantMutation(revokeAction);

export const listAccessAction = defineUserQuery({
  path: "assistant/sharing:listAccess",
  description: "Lists who an assistant chat is shared with and what each may do, a page at a time: its owner, people and organizations.",
  args: { threadId: v.id("assistantThreads"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      principal: assistantPrincipalValidator,
      role: assistantRoleValidator,
      /** A person's name as they gave it, or empty when they gave none. */
      name: v.string(),
      /** A person's email, for the chat's owner only. */
      email: v.optional(v.string()),
      /** An organization's active members, counted up to one past MEMBERS_COUNTED. */
      members: v.optional(v.number()),
    }),
  ),
  run: async (ctx, userId, { threadId, paginationOpts }) => {
    await requireFeature(ctx, FLAG, userId);
    const { role } = await requireThread(ctx, userId, threadId);
    const read = await ctx.db
      .query("assistantThreadAccess")
      .withIndex("by_thread_and_principal", (q) => q.eq("threadId", threadId))
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, ACCESS_PAGE_MAX) });
    const page = await Promise.all(
      read.page.map(async (row) => {
        const principal = principalOf(ctx, row.principal);
        if (!principal) return [];
        if (principal.kind === "organization") {
          const organization = await ctx.db.get("organizations", principal.organizationId);
          if (!organization) return [];
          const members = await ctx.db
            .query("organizationMemberships")
            .withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organization._id).eq("state", "active"))
            .take(MEMBERS_COUNTED + 1);
          return [{ principal, role: row.role, name: organization.name, members: members.length }];
        }
        const person = await ctx.db.get("users", principal.userId);
        if (!person) return [];
        return [{ principal, role: row.role, name: personName(person), ...(role === "owner" ? { email: person.email } : {}) }];
      }),
    );
    return { ...read, page: page.flat() };
  },
});
export const listAccess = userQuery(listAccessAction);
export const listAccessForAssistant = assistantQuery(listAccessAction);

export const candidatesAction = defineUserQuery({
  path: "assistant/sharing:candidates",
  description:
    "Suggests who the person could share an assistant chat with: the organizations they belong to, then the people in them, a few at a time. " +
    "Given `text`, only those whose name or email contains it.",
  args: { text: v.optional(v.string()) },
  returns: assistantCandidatesValidator,
  run: async (ctx, userId, { text }) => {
    await requireFeature(ctx, FLAG, userId);
    const me = await ctx.db.get("users", userId);
    if (!me) return [];
    const needle = text?.trim().toLowerCase() ?? "";
    const matches = (...fields: string[]) => !needle || fields.some((field) => field.toLowerCase().includes(needle));
    const mine = [...(await organizationsOf(ctx, me)).values()];
    const organizations = mine
      .filter((organization) => matches(organization.name))
      .slice(0, ASSISTANT_CANDIDATES_SHOWN)
      .map((organization) => ({ principal: { kind: "organization" as const, organizationId: organization._id }, name: organization.name }));
    const wanted = ASSISTANT_CANDIDATES_SHOWN - organizations.length;
    if (!wanted) return organizations;

    // The people in those organizations, each once however many they share with the person.
    const seen = new Set<string>([me.clerkId]);
    const found = new Map<string, Doc<"users">>();
    await mergedStream(
      mine.map((organization) =>
        stream(ctx.db, schema)
          .query("organizationMemberships")
          .withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organization._id).eq("state", "active")),
      ),
      ["_creationTime"],
    )
      .filterWith(async (membership) => {
        if (seen.has(membership.clerkUserId)) return false;
        seen.add(membership.clerkUserId);
        const person = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", membership.clerkUserId)).unique();
        if (person?.state !== "active" || !matches(personName(person), person.email)) return false;
        found.set(membership.clerkUserId, person);
        return true;
      })
      .paginate({ cursor: null, numItems: wanted, maximumRowsRead: CANDIDATE_ROWS });
    const people = [...found.values()].slice(0, wanted).map((person) => ({ principal: { kind: "user" as const, userId: person._id }, name: personName(person), email: person.email }));
    return [...organizations, ...people];
  },
});
export const candidates = userQuery(candidatesAction);
export const candidatesForAssistant = assistantQuery(candidatesAction);
