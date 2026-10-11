import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { requireActiveUser, requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";

export const actorValidator = v.object({
  userId: v.id("users"),
  workspaceId: v.id("workspaces"),
  role: v.union(v.literal("admin"), v.literal("member")),
});
/** Who is acting, in which workspace, with which role there (#650). */
export type Actor = Infer<typeof actorValidator>;
/** A person and the workspace they read or write in, whatever their role there. */
export type InWorkspace = Pick<Actor, "userId" | "workspaceId">;

/**
 * Refuses taking away what someone else made unless `actor` is an admin of the workspace
 * (#650). In their own workspace a person is its admin, so nothing is refused there.
 */
export function requireMakerOrAdmin(actor: Actor, createdBy: Id<"users"> | undefined) {
  if (actor.role !== "admin" && createdBy !== actor.userId) throw createError("FORBIDDEN", "Only an admin of this workspace changes or takes away what someone else made.");
}

/**
 * `user` acting in `workspaceId`: their own workspace, which they're the admin of, or an
 * active organization they're an active member of. Any other is refused as not found, so
 * nobody outside a workspace learns that it exists. Convex never takes the token's active
 * organization for this; it reads the memberships the Clerk webhook keeps.
 */
export async function actorFor(ctx: Pick<QueryCtx, "db">, user: Doc<"users">, workspaceId: Id<"workspaces">): Promise<Actor> {
  const actor = await actorIn(ctx, user, workspaceId);
  if (!actor) throw createError("NOT_FOUND", "Workspace not found");
  return actor;
}

/** `actorFor`, or null where it would refuse: for a record opened by its ID, which anyone who can act in its workspace may open. */
export async function actorIn(ctx: Pick<QueryCtx, "db">, user: Doc<"users">, workspaceId: Id<"workspaces">): Promise<Actor | null> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  const role = !workspace
    ? null
    : workspace.kind === "personal"
      ? workspace.userId === user._id ? "admin" : null
      : await organizationRole(ctx, workspace.organizationId, user.clerkId);
  return role ? { userId: user._id, workspaceId, role } : null;
}

/**
 * Who reads a page and where (#651): the workspace it names, while they're in it, or their own
 * when it names none. Null when signed out or not in it.
 */
export async function workingIn(ctx: Pick<QueryCtx, "db">, user: Doc<"users"> | null, workspaceId: Id<"workspaces"> | undefined): Promise<InWorkspace | null> {
  if (!user) return null;
  if (!workspaceId) return { userId: user._id, workspaceId: await personalWorkspaceOf(ctx, user._id) };
  return (await actorIn(ctx, user, workspaceId)) ? { userId: user._id, workspaceId } : null;
}

async function organizationRole(ctx: Pick<QueryCtx, "db">, organizationId: Id<"organizations">, clerkUserId: string) {
  const organization = await ctx.db.get("organizations", organizationId);
  // One being deleted takes no more work: nothing new can stop its deletion.
  if (organization?.state !== "active" || organization.deletingAt !== undefined) return null;
  const membership = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_organizationId_and_clerkUserId_and_state", (q) => q.eq("organizationId", organizationId).eq("clerkUserId", clerkUserId).eq("state", "active"))
    .first();
  return !membership ? null : membership.role === "org:admin" ? "admin" : "member";
}

export { personalWorkspaceOf } from "./personal";
import { personalWorkspaceOf } from "./personal";

/** `personalWorkspaceOf`, for an action. */
export const personalOf = internalQuery({
  args: { userId: v.id("users") },
  returns: v.id("workspaces"),
  handler: (ctx, { userId }) => personalWorkspaceOf(ctx, userId),
});

/** The signed-in person acting in a workspace, for an action, which can't read the database itself. */
export const signedInActor = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: actorValidator,
  handler: async (ctx, { workspaceId }) => actorFor(ctx, await requireAuth(ctx), workspaceId),
});

/** The person an internal call acts for, in a workspace; refuses a missing, suspended or deleted account. */
export const activeActor = internalQuery({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces") },
  returns: actorValidator,
  handler: async (ctx, { userId, workspaceId }) => actorFor(ctx, await requireActiveUser(ctx, userId), workspaceId),
});
