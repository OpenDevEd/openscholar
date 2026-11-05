/**
 * The author records that are a profile's person. Our index can split one person into several records, so a profile links as
 * many as it needs, and a record belongs to one profile at most. A profile's main record, `openalex`, is one of them.
 */
import { v } from "convex/values";
import { isAuthorId } from "../../lib/openalex/author-filter";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { noteActivity } from "../activity/notes";
import { createError } from "../lib/errors";
import { query } from "../lib/functions";
import { assistantMutation, defineUserMutation, signedInAs, userMutation } from "../lib/userActions";
import { requireProfileAccess } from "./access";
import { createProfile, requireAuthorProfiles } from "./profiles";
import { AUTHOR_IDS_LOOKED_UP, MAX_PROFILE_RECORDS, profileRecordsValidator } from "./validators";

const authorIdOf = (given: string) => {
  const id = given.trim().replace(/^https?:\/\/(?:openalex\.org|openscholar\.ai)\/(?:authors\/)?/, "").toUpperCase();
  if (!isAuthorId(id)) throw createError("VALIDATION_ERROR", "An author record's ID is such as A5023888391 or OSA2259683.");
  return id;
};

const linkOf = (ctx: QueryCtx, authorId: string) => ctx.db.query("authorRecordLinks").withIndex("by_authorId", (q) => q.eq("authorId", authorId)).first();
const recordsOf = (ctx: QueryCtx, profileId: Id<"authorProfiles">) => ctx.db.query("authorRecordLinks").withIndex("by_profileId", (q) => q.eq("profileId", profileId)).take(MAX_PROFILE_RECORDS);

/** The profile that holds a record: by a link, or as its main record, which a profile may have from before links. */
async function holderOf(ctx: QueryCtx, authorId: string) {
  const link = await linkOf(ctx, authorId);
  if (link) return link.profileId;
  return (await ctx.db.query("authorProfiles").withIndex("by_openalex", (q) => q.eq("openalex", authorId)).first())?._id ?? null;
}

/** Links a record to a profile, unless it's already this profile's. Another profile's stays theirs. */
export async function linkRecord(ctx: MutationCtx, profileId: Id<"authorProfiles">, authorId: string) {
  const holder = await holderOf(ctx, authorId);
  if (holder && holder !== profileId) throw createError("CONFLICT", "That author record is linked to another profile.");
  if (await linkOf(ctx, authorId)) return;
  if ((await recordsOf(ctx, profileId)).length >= MAX_PROFILE_RECORDS) throw createError("VALIDATION_ERROR", `A profile links at most ${MAX_PROFILE_RECORDS} author records.`);
  await ctx.db.insert("authorRecordLinks", { profileId, authorId });
}

/** Keeps the links in step with a profile's main record as it changes. */
export async function moveMainRecord(ctx: MutationCtx, profileId: Id<"authorProfiles">, from: string, to: string) {
  if (from === to) return;
  const old = from ? await linkOf(ctx, from) : null;
  if (old?.profileId === profileId) await ctx.db.delete("authorRecordLinks", old._id);
  if (to) await linkRecord(ctx, profileId, to);
}

/** The IDs of the records a profile links, the main one among them. Public, as its page is. */
export const records = query({
  args: { profileId: v.string() },
  returns: profileRecordsValidator,
  handler: async (ctx, { profileId }) => {
    const id = ctx.db.normalizeId("authorProfiles", profileId);
    return id ? (await recordsOf(ctx, id)).map((link) => link.authorId) : [];
  },
});

/** The profile that links any of these IDs, the ones one person goes by, or null. Public, as a profile's page is. */
export const profileFor = query({
  args: { ids: v.array(v.string()) },
  returns: v.union(v.id("authorProfiles"), v.null()),
  handler: async (ctx, { ids }) => {
    if (ids.length > AUTHOR_IDS_LOOKED_UP) throw createError("VALIDATION_ERROR", `At most ${AUTHOR_IDS_LOOKED_UP} IDs at once.`);
    for (const id of ids) {
      const holder = await holderOf(ctx, id);
      if (holder) return holder;
    }
    return null;
  },
});

export const addAction = defineUserMutation({
  path: "authors/links:add",
  description:
    "Links another author record to an author profile, for one of its owners or editors: one the search index splits this person into, by its ID such as OSA2259683 or A5023888391. " +
    "The profile's Search papers and its page then read every record it links. A record belongs to one profile at most, and a profile links at most 20.",
  args: { profileId: v.id("authorProfiles"), authorId: v.string() },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: true,
  undoable: false,
  run: async (ctx, { userId, author }, { profileId, authorId }) => {
    const { profile } = await requireProfileAccess(await signedInAs(ctx, userId), profileId);
    await linkRecord(ctx, profileId, authorIdOf(authorId));
    if (profile.workspaceId) await noteActivity(ctx, { workspaceId: profile.workspaceId, by: userId, viaAssistant: author === "assistant" }, { kind: "author", id: profileId, happened: "edited" });
    return null;
  },
});
export const add = userMutation(addAction);
export const addForAssistant = assistantMutation(addAction);

export const removeAction = defineUserMutation({
  path: "authors/links:remove",
  description: "Takes an author record off an author profile, for one of its owners or editors. A profile's main record changes with the profile itself, not here.",
  args: { profileId: v.id("authorProfiles"), authorId: v.string() },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: true,
  undoable: false,
  run: async (ctx, { userId, author }, { profileId, authorId }) => {
    const { profile } = await requireProfileAccess(await signedInAs(ctx, userId), profileId);
    const id = authorIdOf(authorId);
    if (id === profile.openalex) throw createError("VALIDATION_ERROR", "That's this profile's main record: change it in the profile's settings.");
    const link = await linkOf(ctx, id);
    if (link?.profileId !== profileId) return null;
    await ctx.db.delete("authorRecordLinks", link._id);
    if (profile.workspaceId) await noteActivity(ctx, { workspaceId: profile.workspaceId, by: userId, viaAssistant: author === "assistant" }, { kind: "author", id: profileId, happened: "edited" });
    return null;
  },
});
export const remove = userMutation(removeAction);
export const removeForAssistant = assistantMutation(removeAction);

export const claimAction = defineUserMutation({
  path: "authors/links:claim",
  description:
    "Makes an author profile from an author record, owned by the workspace the reply runs in, whose plan must have Evidence Communities: named as given, with that record as its main one. " +
    "Refused when another profile links the record, or any of `knownAs`, the other IDs this person goes by, as far as they're known. Nothing here checks that the person is that author.",
  args: { authorId: v.string(), knownAs: v.optional(v.array(v.string())), name: v.string() },
  returns: v.id("authorProfiles"),
  spendsCredits: false,
  // The directory lists it to everyone who reads it, and nothing takes it away by itself.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, { userId, workspaceId, author }, { authorId, knownAs, name }) => {
    await requireAuthorProfiles(ctx, workspaceId);
    const id = authorIdOf(authorId);
    if ((knownAs?.length ?? 0) > AUTHOR_IDS_LOOKED_UP) throw createError("VALIDATION_ERROR", `At most ${AUTHOR_IDS_LOOKED_UP} IDs at once.`);
    for (const known of [id, ...(knownAs ?? []).map(authorIdOf)]) {
      if (await holderOf(ctx, known)) throw createError("CONFLICT", "That author record is linked to another profile.");
    }
    const profileId = await createProfile(ctx, userId, workspaceId, name, author === "assistant");
    await ctx.db.patch("authorProfiles", profileId, { openalex: id });
    await linkRecord(ctx, profileId, id);
    return profileId;
  },
});
export const claim = userMutation(claimAction);
export const claimForAssistant = assistantMutation(claimAction);
