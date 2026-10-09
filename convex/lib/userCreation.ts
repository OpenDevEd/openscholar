import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { readAccount } from "../billing/accounts";
import { ensureWorkspace } from "../workspaces/create";

export async function createUserWithDefaults(
  ctx: MutationCtx,
  userData: {
    clerkId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
  }
): Promise<Id<"users">> {
  const now = Date.now();

  const userId = await ctx.db.insert("users", {
    ...userData,
    state: "active",
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const workspaceId = await ensureWorkspace(ctx, { kind: "personal", userId });
  // A new person starts with a count row, so the library never reads the count on their user row.
  await ctx.db.insert("libraryCounts", { workspaceId, count: 0 });

  await ctx.scheduler.runAfter(0, internal.billing.accounts.provision, { userId });
  return userId;
}

/** Sets up billing for a user whose earlier provisioning never finished. */
export async function ensureBillingAccount(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> {
  const own = await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
  if (own && (await readAccount(ctx, own._id))?.signupGranted) return;
  await ctx.scheduler.runAfter(0, internal.billing.accounts.provision, { userId });
}
