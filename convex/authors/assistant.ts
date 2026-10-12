/**
 * Author profiles as the assistant works them (#323): the directory, one profile, who has it, the
 * person's invitations to edit one, a profile's publications read from their libraries, and
 * making one. Each runs the Authors pages' own reads as the person.
 */
import { v, type Infer } from "convex/values";
import { api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
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

/** A profile as the assistant lists it. */
const summary = (profile: Doc<"authorProfiles">) => ({ profileId: profile._id, name: profile.name, headline: profile.headline, affiliation: profile.affiliation, orcid: profile.orcid, openalex: profile.openalex });

export const directoryAction = defineUserQuery({
  path: "authors/assistant:directory",
  description:
    `Lists author profiles, ${AUTHORS_LISTED} a page from \`cursor\`, newest first or the ones whose name matches \`search\`: each one's ID, name, headline, affiliation, ORCID and OpenAlex author ID; \`continueCursor\` is the next page's \`cursor\` until \`isDone\`. ` +
    "In a workspace whose plan has Evidence Libraries, as the Authors page. One profile whole is authors/assistant:profile.",
  args: { search: v.optional(v.union(v.string(), v.null())), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: authorDirectoryValidator,
  run: async (ctx, { workspaceId }, { search, cursor }) => {
    await requireAuthorProfiles(ctx, workspaceId);
    const read = await searchProfilePage(ctx, search ?? "", { numItems: AUTHORS_LISTED, cursor: cursor ?? null });
    return { page: read.page.map(summary), isDone: read.isDone, continueCursor: read.continueCursor };
  },
});
export const directory = userQuery(directoryAction);
export const directoryForAssistant = assistantQuery(directoryAction);

export const profileAction = defineUserQuery({
  path: "authors/assistant:profile",
  description:
    "Reads an author profile by its ID, as its public page shows it: name, headline, affiliation, bio, website, LinkedIn, ORCID and OpenAlex author ID, and whether the person owns or edits it. Null when there's none. " +
    "Its publications are authors/assistant:publications, and who has it authors/assistant:editors.",
  args: { profileId: v.string() },
  returns: authorProfileReadValidator,
  run: async (ctx, { userId }, { profileId }) => {
    const profile = await readProfile(await signedInAs(ctx, userId), profileId);
    return profile && { ...summary(profile), bio: profile.bio, website: profile.website, linkedin: profile.linkedin, role: profile.role, member: profile.member };
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
    const here = profile?.workspaceId !== undefined && (profile.workspaceId === actor.workspaceId || (await guestRole(ctx, actor, { _id: profile._id, workspaceId: profile.workspaceId })) !== null);
    if (!here) throw createError("NOT_FOUND", "Author profile not found");
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
    "Makes an author profile with this name, owned by the workspace the reply runs in, whose plan must have Evidence Libraries. Its page is public and the Authors directory lists it; the rest of it is filled in on its page. Asks the person first.",
  args: { name: v.string() },
  returns: v.id("authorProfiles"),
  spendsCredits: false,
  // The directory lists it to everyone who reads it, and nothing takes it away by itself.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, { userId, workspaceId, author }, { name }) => {
    await requireAuthorProfiles(ctx, workspaceId);
    return await createProfile(ctx, userId, workspaceId, name, author === "assistant");
  },
});
export const create = userMutation(createAction);
export const createForAssistant = assistantMutation(createAction);

export const publicationsAction = defineUserAction({
  path: "authors/assistant:publications",
  description:
    `Reads an author profile's publications, ${AUTHOR_PUBLICATIONS_READ} at a time from \`start\` (0 first), each from the Evidence Library it's in: title, type, year, authors, its page and the library's name. ` +
    "`next` is the next `start`, and `unavailable` counts the ones a library couldn't answer for now.",
  args: { profileId: v.string(), start: v.optional(v.union(v.number(), v.null())) },
  returns: authorPublicationsReadValidator,
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, _actor, { profileId, start }): Promise<Infer<typeof authorPublicationsReadValidator>> => {
    const references = await ctx.runQuery(api.authors.publications.list, { profileId });
    const from = Math.max(0, Math.floor(start ?? 0));
    const shown = references.slice(from, from + AUTHOR_PUBLICATIONS_READ);
    const { papers, unavailableCount } = await authorPublicationsFrom(shown, fetchPublicationCard, profileId);
    return {
      publications: papers.map(({ id, title, type, year, authors, url, library }) => ({ id, title, type, year, authors, url, library: library.name })),
      unavailable: unavailableCount,
      ...(references.length > from + shown.length ? { next: from + shown.length } : {}),
    };
  },
});
export const publications = userAction(publicationsAction);
export const publicationsForAssistant = assistantAction(publicationsAction);
