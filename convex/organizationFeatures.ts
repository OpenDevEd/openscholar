import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { opensLibraries } from "./billing/accounts";
import { getCurrentUser, getIdentity } from "./lib/auth";
import { createError } from "./lib/errors";
import { MAX_ORGANIZATIONS_PER_PERSON } from "./lib/queryBounds";
import { readActiveOrganizationMembership } from "./evidenceLibraries/access";
import { workspaceQuery } from "./lib/userActions";
import { profileMaker } from "./authors/access";

/** The same active memberships drive feature access and organization pickers. */
export async function readMemberOrganizations(ctx: QueryCtx | MutationCtx, person?: Doc<"users"> | null) {
  const user = person ?? (await getCurrentUser(ctx));
  if (!user) return [];
  const memberships = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_clerkUserId_and_state", (q) =>
      q.eq("clerkUserId", user.clerkId).eq("state", "active"),
    )
    .take(MAX_ORGANIZATIONS_PER_PERSON + 1);
  // Clerk's webhooks write memberships, so no write here can refuse one more.
  if (memberships.length > MAX_ORGANIZATIONS_PER_PERSON) {
    throw createError("VALIDATION_ERROR", `This account belongs to more than ${MAX_ORGANIZATIONS_PER_PERSON} organizations, more than Openscholar reads. Leave some to continue.`);
  }
  const rows = await Promise.all(
    memberships.map(async (membership) => ({
      membership,
      organization: await ctx.db.get(
        "organizations",
        membership.organizationId,
      ),
    })),
  );
  return rows.flatMap(({ membership, organization }) =>
    organization?.state === "active" ? [{ membership, organization }] : [],
  );
}

/** Whether the person may create a community in the workspace: it has them switched on (`opensLibraries`), and it's their own or an organization they're an admin of. */
export async function createsIn(ctx: QueryCtx | MutationCtx, user: Doc<"users">, workspace: Doc<"workspaces">) {
  if (user.state !== "active") return false;
  if (workspace.kind === "personal" ? workspace.userId !== user._id : (await ctx.db.get("organizations", workspace.organizationId))?.state !== "active" || (await readActiveOrganizationMembership(ctx, workspace.organizationId, user.clerkId))?.role !== "org:admin") return false;
  return await opensLibraries(ctx, workspace._id);
}

/** The workspace a new community is created in, refused unless the signed-in person may create one there. */
export async function requireCommunityWorkspace(ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">) {
  if (!(await getIdentity(ctx))) throw createError("UNAUTHENTICATED", "Sign in to create a community.");
  const [user, workspace] = await Promise.all([getCurrentUser(ctx), ctx.db.get("workspaces", workspaceId)]);
  if (!user || !workspace || !(await createsIn(ctx, user, workspace))) {
    throw createError("FORBIDDEN", "Communities can be created in your own workspace or an organization you're an admin of, once Evidence Communities are on for it.");
  }
  return { workspace, workspaceId, user, clerkUserId: user.clerkId };
}

/**
 * What the workspace the page is in has for the person: whether Evidence Communities, and author
 * profiles with them, are on for it, and whether the person may create a community in it.
 */
export const opens = workspaceQuery({
  args: {},
  // `createsAuthors`: whether they may make an author profile in it (../authors/access.ts, #1093).
  returns: v.object({ evidenceLibraries: v.boolean(), authors: v.boolean(), createsCommunities: v.boolean(), createsAuthors: v.boolean() }),
  signedOut: { evidenceLibraries: false, authors: false, createsCommunities: false, createsAuthors: false },
  handler: async (ctx, actor) => {
    const [on, user, workspace] = await Promise.all([opensLibraries(ctx, actor.workspaceId), ctx.db.get("users", actor.userId), ctx.db.get("workspaces", actor.workspaceId)]);
    return {
      evidenceLibraries: on,
      authors: on,
      createsCommunities: on && user !== null && workspace !== null && (await createsIn(ctx, user, workspace)),
      createsAuthors: on && user !== null && (await profileMaker(ctx, user, actor.workspaceId)) !== null,
    };
  },
});
