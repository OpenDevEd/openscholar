import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { personName } from "../lib/people";
import { MAX_ORGANIZATIONS_PER_PERSON } from "../lib/queryBounds";

// Kept apart from ./actor.ts, which reads auth: the database triggers reach these, and must load
// without the modules that load the triggers themselves.

/**
 * A person's own workspace: where a reply of theirs in a chat shared with them from outside
 * acts (convex/assistant/access.ts `replyWorkspace`), and the one the browser names until
 * pages carry theirs (#651).
 */
export async function personalWorkspaceOf(ctx: Pick<QueryCtx, "db">, userId: Id<"users">): Promise<Id<"workspaces">> {
  const workspace = await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
  if (!workspace) throw createError("NOT_FOUND", "Workspace not found");
  return workspace._id;
}

/** The workspaces a person is in: their own, and their organizations'. */
export async function workspacesOf(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  const user = await ctx.db.get("users", userId);
  if (!user) return [];
  const own = await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
  const memberships = await ctx.db.query("organizationMemberships").withIndex("by_clerkUserId_and_state", (q) => q.eq("clerkUserId", user.clerkId).eq("state", "active")).take(MAX_ORGANIZATIONS_PER_PERSON);
  const organizations = await Promise.all(memberships.map((membership) => ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", membership.organizationId)).unique()));
  return [own, ...organizations].flatMap((workspace) => (workspace ? [workspace] : []));
}

/** An organization's workspace, made with it (#650). */
export async function organizationWorkspaceOf(ctx: Pick<QueryCtx, "db">, organizationId: Id<"organizations">): Promise<Id<"workspaces">> {
  const workspace = await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique();
  if (!workspace) throw createError("NOT_FOUND", "Workspace not found");
  return workspace._id;
}


/** A workspace as someone outside it is told of it: an organization's name, or for a person's own their name, and which of the two it is. */
export async function workspaceFrom(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">) {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (workspace?.kind === "organization") return { name: (await ctx.db.get("organizations", workspace.organizationId))?.name ?? "", organization: true };
  const person = workspace ? await ctx.db.get("users", workspace.userId) : null;
  return { name: (person && (personName(person) || person.email)) || "", organization: false };
}

/** A workspace as a person sees it named: an organization's name, or for someone's own their name. */
export const workspaceName = async (ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">) => (await workspaceFrom(ctx, workspaceId)).name;
