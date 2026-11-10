// A person's profile setup: the institutions they're at, their ORCID iD and the emails they want from Openscholar. A
// new account is asked once, in front of the first page it opens (components/profile/profile-setup.tsx); everyone
// edits the same answers in Settings › Profile.
import { v } from "convex/values";
import { query } from "../_generated/server";
import { mutation } from "../lib/functions";
import { getCurrentUser, getIdentity, refuseApps, requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { PROFILE_AFFILIATIONS_MAX, profileValidator } from "../lib/validators";
import { isOrcid } from "../../lib/reports/report";
import type { Doc } from "../_generated/dataModel";

/** Accounts made from this moment are asked on their first visit; older ones find the same answers in Settings. */
export const SETUP_RELEASED_AT = Date.parse("2026-11-10T00:00:00Z");

const ROR = /^https:\/\/ror\.org\/0[a-z0-9]{8}$/;

const answersOf = (user: Doc<"users">) => user.profile ?? { affiliations: [], orcid: "", emails: { updates: false, news: false, research: false } };
/** A new account that hasn't finished or skipped the setup. */
const dueFor = (user: Doc<"users">) => !user.onboarding && user.createdAt >= SETUP_RELEASED_AT;

/** The person's answers, and whether the setup still stands in front of every page. Null signed out. */
export const get = query({
  args: {},
  returns: v.union(v.null(), v.object({ profile: profileValidator, due: v.boolean() })),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user ? { profile: answersOf(user), due: dueFor(user) } : null;
  },
});

/**
 * Whether the page the server is about to draw is the setup instead. Someone signed in whose account row isn't made
 * yet is new, made a moment ago: it is theirs too.
 */
export const due = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const identity = await getIdentity(ctx);
    if (!identity) return false;
    const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject)).unique();
    return user ? user.state === "active" && dueFor(user) : true;
  },
});

/** Saves the answers, from the setup or from Settings; the setup is then done. */
export const save = mutation({
  args: profileValidator.fields,
  returns: v.null(),
  handler: async (ctx, { affiliations, orcid, emails }) => {
    await refuseApps(ctx);
    const user = await requireAuth(ctx);
    if (affiliations.length > PROFILE_AFFILIATIONS_MAX) throw createError("VALIDATION_ERROR", `List at most ${PROFILE_AFFILIATIONS_MAX} institutions.`);
    for (const affiliation of affiliations) {
      if (!affiliation.name.trim() || affiliation.name.length > 300) throw createError("VALIDATION_ERROR", "An institution needs a name of up to 300 characters.");
      if (affiliation.ror !== undefined && !ROR.test(affiliation.ror)) throw createError("VALIDATION_ERROR", "That isn't a ROR ID.");
    }
    if (orcid !== "" && !isOrcid(orcid)) throw createError("VALIDATION_ERROR", "That isn't an ORCID iD. One looks like 0000-0002-1825-0097.");
    await ctx.db.patch("users", user._id, {
      profile: { affiliations: affiliations.map((a) => ({ ...a, name: a.name.trim() })), orcid, emails },
      onboarding: { ...user.onboarding, finishedAt: user.onboarding?.finishedAt ?? Date.now() },
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** The person skipped the setup: it stands in front of pages no more. Answers saved before stay. */
export const skip = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await refuseApps(ctx);
    const user = await requireAuth(ctx);
    await ctx.db.patch("users", user._id, { onboarding: { ...user.onboarding, skippedAt: Date.now() }, updatedAt: Date.now() });
    return null;
  },
});
