import { v } from "convex/values";
import { capped } from "../lib/listCaps";
import { MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL, MAX_PROFILE_MEMBERS } from "../lib/queryBounds";

export const authorContentFields = {
  name: v.string(),
  headline: v.string(),
  affiliation: v.string(),
  bio: v.string(),
  website: v.string(),
  linkedin: v.string(),
  orcid: v.string(),
  openalex: v.string(),
};

export const profileRoleValidator = v.union(v.literal("owner"), v.literal("editor"));

/** Its editors, who are its guests (#653), and its owners through its workspace: its maker, the person whose own workspace it is, and an organization's admins (./access.ts `profileOwners`). */
export const profileMembersValidator = capped(
  // `you`: the person reading the list.
  v.array(v.object({userId: v.id("users"), name: v.string(), email: v.string(), imageUrl: v.optional(v.string()), role: profileRoleValidator, you: v.boolean()})),
  2 * MAX_PROFILE_MEMBERS + 2,
);

/** A profile's invitations waiting, as its Access section lists them: each holds one of its guests' places (../sharing/access.ts `requireRoom`). */
export const profileInvitationsValidator = capped(
  v.array(v.object({_id: v.id("itemInvitations"), email: v.string(), delivery: v.union(v.literal("queued"), v.literal("sent"), v.literal("failed"))})),
  MAX_PROFILE_MEMBERS,
);

/** Who has a profile, for its Access section and the assistant (./members.ts). */
export const profileAccessValidator = v.object({role: profileRoleValidator, members: profileMembersValidator, invitations: profileInvitationsValidator});

/** An invitation to edit a profile, waiting for the person (./invitations.ts). */
export const profileInvitationWaitingValidator = v.object({invitationId: v.id("itemInvitations"), profileId: v.id("authorProfiles"), name: v.string()});
/** All of them: an address has at most this many invitations waiting, to anything. */
export const profileInvitationsWaitingValidator = capped(v.array(profileInvitationWaitingValidator), MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL);

/** Author records one profile links (./links.ts). */
export const MAX_PROFILE_RECORDS = 20;
export const profileRecordsValidator = capped(v.array(v.string()), MAX_PROFILE_RECORDS);
/** IDs of one person that one lookup of a profile takes. */
export const AUTHOR_IDS_LOOKED_UP = 5;

/** A profile as the assistant lists it (./assistant.ts). */
const authorSummaryFields = {profileId: v.id("authorProfiles"), name: v.string(), headline: v.string(), affiliation: v.string(), orcid: v.string(), openalex: v.string()};
/** Profiles one page of the directory gives (./profiles.ts `searchProfilePage`). */
export const AUTHORS_LISTED = 30;
export const authorDirectoryValidator = v.object({page: capped(v.array(v.object(authorSummaryFields)), AUTHORS_LISTED), isDone: v.boolean(), continueCursor: v.string()});
/** A profile as its public page shows it, with what the person is to it. */
export const authorProfileReadValidator = v.union(v.null(), v.object({
  ...authorSummaryFields, bio: v.string(), website: v.string(), linkedin: v.string(),
  role: v.union(profileRoleValidator, v.null()), member: v.boolean(),
}));

/** A profile's publications one read of the assistant's gives, each read from its library (./assistant.ts). */
export const AUTHOR_PUBLICATIONS_READ = 20;
/** A publication of a profile's, and the library it's in (./publications.ts). */
export const publicationReferenceValidator = v.object({
  id: v.id("authorPublications"), itemKey: v.string(), rank: v.optional(v.number()),
  library: v.object({id: v.id("evidenceLibraries"), name: v.string(), url: v.string()}),
});
export const publicationReferencePageValidator = v.object({page: capped(v.array(publicationReferenceValidator), AUTHOR_PUBLICATIONS_READ), isDone: v.boolean(), continueCursor: v.string()});
export const authorPublicationsReadValidator = v.object({
  publications: capped(v.array(v.object({id: v.string(), title: v.string(), type: v.string(), year: v.string(), authors: v.string(), url: v.string(), library: v.string()})), AUTHOR_PUBLICATIONS_READ),
  // Ones a library couldn't answer for now.
  unavailable: v.number(),
  next: v.optional(v.string()),
});
