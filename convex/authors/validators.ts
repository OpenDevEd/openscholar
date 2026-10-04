import { v } from "convex/values";
import { capped } from "../lib/listCaps";
import { MAX_PENDING_INVITATIONS_PER_PROFILE, MAX_PROFILE_MEMBERS } from "../lib/queryBounds";

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

export const authorProfileInvitationFields = {
  profileId: v.id("authorProfiles"),
  email: v.string(),
  invitedBy: v.id("users"),
  expiresAt: v.number(),
  state: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined"), v.literal("cancelled"), v.literal("expired")),
  delivery: v.union(v.literal("queued"), v.literal("sent"), v.literal("failed")),
};

export const profileRoleValidator = v.union(v.literal("owner"), v.literal("editor"));

/** A profile's owner and the people it gives editing to: accepting an invitation past the cap is refused (./invitations.ts). */
export const profileMembersValidator = capped(
  v.array(v.object({userId: v.id("users"), name: v.string(), email: v.string(), imageUrl: v.optional(v.string()), role: profileRoleValidator})),
  MAX_PROFILE_MEMBERS + 1,
);

/** A profile's invitations waiting: sending another past the cap is refused (./invitations.ts). */
export const profileInvitationsValidator = capped(
  v.array(v.object({_id: v.id("authorProfileInvitations"), _creationTime: v.number(), ...authorProfileInvitationFields})),
  MAX_PENDING_INVITATIONS_PER_PROFILE,
);
