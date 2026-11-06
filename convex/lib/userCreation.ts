import { MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { readAccount } from "../billing/accounts";
import { ensureWorkspace } from "../workspaces/create";
import { captureLater } from "./analyticsEvents";
import { recordAppUse } from "./appCalls";

export async function createUserWithDefaults(
  ctx: MutationCtx,
  userData: {
    clerkId: string;
    email: string;
    verifiedEmails?: string[];
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
    analyticsConsent?: Doc<"users">["analyticsConsent"];
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
  await captureLater(ctx, [{ distinctId: userData.clerkId, event: "account_created", properties: {}, timestamp: now }]);
  // A person who signs up through a developer app has no account when the mutation starts, so its site goes on their list now.
  await recordAppUse(ctx);
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
