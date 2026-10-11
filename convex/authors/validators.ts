import { v } from "convex/values";
import { capped } from "../lib/listCaps";
import { MAX_PROFILE_MEMBERS } from "../lib/queryBounds";

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
