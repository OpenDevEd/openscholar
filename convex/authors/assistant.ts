/**
 * Author profiles as the assistant works them (#323): the directory, one profile, who has it, the
 * person's invitations to edit one, a profile's publications read from their libraries, and
 * making one. Each runs the Authors pages' own reads as the person.
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { InWorkspace } from "../workspaces/actor";
import { createError } from "../lib/errors";
import { assistantAction, assistantMutation, assistantQuery, defineUserAction, defineUserMutation, defineUserQuery, signedInAs, userAction, userMutation, userQuery } from "../lib/userActions";
import { inOwnWorkspace } from "../workspaces/actor";
import { guestRole } from "../sharing/items";
import { createProfile, readProfile, requireAuthorProfiles, searchProfilePage } from "./profiles";
import { readProfileMembers } from "./members";
import { readProfileInvitations } from "./invitations";
import { AUTHOR_PUBLICATIONS_READ, AUTHORS_LISTED, authorDirectoryValidator, authorProfileReadValidator, authorPublicationsReadValidator, profileAccessValidator, profileInvitationsWaitingValidator } from "./validators";
import { authorPublicationsFrom } from "../../lib/authors/publications";
import { fetchPublicationCard } from "../../lib/evidence-libraries/publication-cards";

/**
 * Whether a reply may say what the person is to a profile and who has it: for a profile of the
 * workspace it runs in or, in the person's own workspace, one shared with them. Elsewhere it
 * would tell another workspace's people about it.
 */
async function profileHere(ctx: QueryCtx, actor: InWorkspace, profile: Doc<"authorProfiles">) {
  return profile.workspaceId !== undefined && (profile.workspaceId === actor.workspaceId || (await guestRole(ctx, actor, { _id: profile._id, workspaceId: profile.workspaceId })) !== null);
}

/** A profile as the assistant lists it. */
const summary = (profile: Doc<"authorProfiles">) => ({ profileId: profile._id, name: profile.name, headline: profile.headline, affiliation: profile.affiliation, orcid: profile.orcid, openalex: profile.openalex });

export const directoryAction = defineUserQuery({
  path: "authors/assistant:directory",
  description:
    `Lists author profiles, ${AUTHORS_LISTED} a page from \`cursor\`, newest first or the ones whose name matches \`search\`: each one's ID, name, headline, affiliation, ORCID and OpenAlex author ID; \`continueCursor\` is the next page's \`cursor\` until \`isDone\`. ` +
    "Public, as the Authors page is. One profile whole is authors/assistant:profile.",
  args: { search: v.optional(v.union(v.string(), v.null())), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: authorDirectoryValidator,
  run: async (ctx, _actor, { search, cursor }) => {
    const read = await searchProfilePage(ctx, search ?? "", { numItems: AUTHORS_LISTED, cursor: cursor ?? null });
    return { page: read.page.map(summary), isDone: read.isDone, continueCursor: read.continueCursor };
  },
});
export const directory = userQuery(directoryAction);
export const directoryForAssistant = assistantQuery(directoryAction);

export const profileAction = defineUserQuery({
  path: "authors/assistant:profile",
  description:
    "Reads an author profile by its ID, as its public page shows it: name, headline, affiliation, bio, website, LinkedIn, ORCID and OpenAlex author ID, and for one of this workspace whether the person owns or edits it. Null when there's none. " +
    "Its publications are authors/assistant:publications, and who has it authors/assistant:editors.",
  args: { profileId: v.string() },
  returns: authorProfileReadValidator,
  run: async (ctx, actor, { profileId }) => {
    const profile = await readProfile(await signedInAs(ctx, actor.userId), profileId);
    if (!profile) return null;
    const here = await profileHere(ctx, actor, profile);
    return { ...summary(profile), bio: profile.bio, website: profile.website, linkedin: profile.linkedin, role: here ? profile.role : null, member: here && profile.member };
  },
});
export const profile = userQuery(profileAction);
export const profileForAssistant = assistantQuery(profileAction);

export const editorsAction = defineUserQuery({
  path: "authors/assistant:editors",
  description:
    "Reads who has an author profile, for an owner or an editor: its owners and editors with their emails, and for an owner the invitations still waiting. " +
    "Only a profile of the workspace the reply runs in or, in the person's own workspace, one shared with them.",
  args: { profileId: v.id("authorProfiles") },
  returns: profileAccessValidator,
  run: async (ctx, actor, { profileId }) => {
    const profile = await ctx.db.get("authorProfiles", profileId);
    // Its people's emails stay out of a chat other people read, of a workspace the profile isn't in.
    if (!profile || !(await profileHere(ctx, actor, profile))) throw createError("NOT_FOUND", "Author profile not found");
    return await readProfileMembers(await signedInAs(ctx, actor.userId), profileId);
  },
});
export const editors = userQuery(editorsAction);
export const editorsForAssistant = assistantQuery(editorsAction);

export const invitationsAction = defineUserQuery({
  path: "authors/assistant:invitations",
  description:
    "Lists the invitations to edit an author profile waiting for the person: each one's ID, and the profile's ID and name. Answer one with sharing/invitations:respond. " +
    "Empty in an organization: what's offered to someone is in their own workspace.",
  args: {},
  returns: profileInvitationsWaitingValidator,
  run: async (ctx, actor) => {
    const person = await ctx.db.get("users", actor.userId);
    return person && (await inOwnWorkspace(ctx, actor)) ? await readProfileInvitations(ctx, person) : [];
  },
});
export const invitations = userQuery(invitationsAction);
export const invitationsForAssistant = assistantQuery(invitationsAction);

export const createAction = defineUserMutation({
  path: "authors/assistant:create",
  description:
    "Makes an author profile with this name, owned by the workspace the reply runs in, whose plan must have Evidence Communities. Returns its ID and name: its page, public, is /authors/<profileId>, and the Authors directory lists it. The rest of it is filled in on its page. Asks the person first.",
  args: { name: v.string() },
  returns: v.object({ profileId: v.id("authorProfiles"), name: v.string() }),
  spendsCredits: false,
  // The directory lists it to everyone who reads it, and nothing takes it away by itself.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, { userId, workspaceId, author }, { name }) => {
    await requireAuthorProfiles(ctx, workspaceId);
    const profileId = await createProfile(ctx, userId, workspaceId, name, author === "assistant");
    return { profileId, name: (await ctx.db.get("authorProfiles", profileId))!.name };
  },
});
export const create = userMutation(createAction);
export const createForAssistant = assistantMutation(createAction);

export const publicationsAction = defineUserAction({
  path: "authors/assistant:publications",
  description:
    `Reads an author profile's publications, ${AUTHOR_PUBLICATIONS_READ} at a time from \`cursor\`, each from the Evidence Community it's in: title, type, year, authors, its page and the community's name. ` +
    "`next` is the next page's `cursor`, and `unavailable` counts the ones a community couldn't answer for now.",
  args: { profileId: v.string(), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: authorPublicationsReadValidator,
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, _actor, { profileId, cursor }): Promise<Infer<typeof authorPublicationsReadValidator>> => {
    const read = await ctx.runQuery(internal.authors.publications.referencePage, { profileId, cursor: cursor ?? null });
    const { papers, unavailableCount } = await authorPublicationsFrom(read.page, fetchPublicationCard, profileId);
    return {
      publications: papers.map(({ id, title, type, year, authors, url, library }) => ({ id, title, type, year, authors, url, library: library.name })),
      unavailable: unavailableCount,
      ...(read.isDone ? {} : { next: read.continueCursor }),
    };
  },
});
export const publications = userAction(publicationsAction);
export const publicationsForAssistant = assistantAction(publicationsAction);
