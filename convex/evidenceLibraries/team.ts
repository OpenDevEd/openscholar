import { v, type ObjectType } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { mutation } from "../lib/functions";
import { libraryGrant, requireEvidenceLibraryAccess, readLibraryRole } from "./access";
import { createError } from "../lib/errors";
import { assertLibraryHasRoom, assertPersonHasRoom } from "./members";
import { invitationTo } from "../sharing/access";

const collaboratorRole = v.union(v.literal("editor"), v.literal("creator"));
export const grantArgs = { libraryId: v.id("evidenceLibraries"), clerkUserId: v.string(), role: collaboratorRole };
export const removeArgs = { libraryId: v.id("evidenceLibraries"), clerkUserId: v.string() };

const account = (ctx: MutationCtx, clerkUserId: string) => ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", clerkUserId)).unique();

/** The library's row for someone who isn't one of its owners, whose access is the organization's to give. */
async function grantFor(ctx: MutationCtx, library: Doc<"evidenceLibraries">, clerkUserId: string) {
  if (await readLibraryRole(ctx, library, clerkUserId) === "owner") throw createError("FORBIDDEN", "Owner access is managed by the organization");
  const person = await account(ctx, clerkUserId);
  return person ? await libraryGrant(ctx, library._id, person._id) : null;
}

/** Direct grants are for existing organization members. External access uses invitations. */
export async function addLibraryMember(ctx: MutationCtx, args: ObjectType<typeof grantArgs>) {
  const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  const organization = access.organization;
  const membership = organization && await ctx.db.query("organizationMemberships")
    .withIndex("by_organizationId_and_clerkUserId_and_state", q => q.eq("organizationId", organization._id).eq("clerkUserId", args.clerkUserId).eq("state", "active"))
    .unique();
  if (!membership) throw createError("FORBIDDEN", "Choose an organization member");
  const [person, by] = await Promise.all([account(ctx, args.clerkUserId), account(ctx, access.clerkUserId)]);
  if (person?.state !== "active" || !by) throw createError("NOT_FOUND", "Person not found");
  // A row that gives no role now, as a disabled library's doesn't, still holds the person's place.
  if (await readLibraryRole(ctx, access.library, args.clerkUserId) || await libraryGrant(ctx, args.libraryId, person._id)) {
    throw createError("CONFLICT", "This person already has access");
  }
  // An invitation to their address that still waits is answered by this: its place in the library becomes theirs.
  const waiting = await invitationTo(ctx, args.libraryId, person.email.toLowerCase());
  if (waiting?.state === "pending") await ctx.db.patch("itemInvitations", waiting._id, { state: "accepted" });
  else await assertLibraryHasRoom(ctx, args.libraryId);
  await assertPersonHasRoom(ctx, person._id);
  await ctx.db.insert("itemAccess", { kind: "library", item: args.libraryId, name: access.library.name, userId: person._id, role: args.role, grantedBy: by._id, grantedAt: Date.now() });
  return null;
}

export const addOrganizationMember = mutation({
  args: grantArgs,
  returns: v.null(),
  handler: addLibraryMember,
});

export async function changeLibraryRole(ctx: MutationCtx, args: ObjectType<typeof grantArgs>) {
  const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  const assignment = await grantFor(ctx, access.library, args.clerkUserId);
  if (!assignment) throw createError("NOT_FOUND", "Library member not found");
  await ctx.db.patch("itemAccess", assignment._id, { role: args.role });
  return null;
}

export const changeRole = mutation({
  args: grantArgs,
  returns: v.null(),
  handler: changeLibraryRole,
});

export async function removeLibraryMember(ctx: MutationCtx, args: ObjectType<typeof removeArgs>) {
  const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  const assignment = await grantFor(ctx, access.library, args.clerkUserId);
  if (assignment) await ctx.db.delete("itemAccess", assignment._id);
  return null;
}

export const removeMember = mutation({
  args: removeArgs,
  returns: v.null(),
  handler: removeLibraryMember,
});
