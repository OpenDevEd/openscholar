// A role in a library for the Evidence Library tests, seeded as an owner's adding someone leaves it.
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Gives the account `clerkUserId` a role in a library: its row in the table every shared item's
 * guests are in (./access.ts). The account is made when the test has none.
 */
export async function grantLibraryRole(ctx: MutationCtx, libraryId: Id<"evidenceLibraries">, clerkUserId: string, role: "editor" | "creator", grantedAt = 1) {
  const account = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique();
  const userId = account?._id ?? (await ctx.db.insert("users", { clerkId: clerkUserId, email: `${clerkUserId}@example.org`, state: "active", createdAt: 1, updatedAt: 1 }));
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  return await ctx.db.insert("itemAccess", { kind: "library", item: libraryId, name: library?.name ?? "", userId, role, grantedBy: userId, grantedAt });
}
