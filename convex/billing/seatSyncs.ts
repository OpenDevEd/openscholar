// Each organization's seat sync row (#652), kept apart from ./seats.ts so the Clerk webhook's
// projection can mark an organization that's gone without loading the sync itself.

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../lib/functions";

export const seatSyncRow = (ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">) => ctx.db.query("seatSyncs").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();

/**
 * An organization that's gone has whatever of Team it held in Autumn ended: a sync now, and the
 * daily check after while one hasn't finished, whatever the seats its row last counted and once
 * its workspace is purged.
 */
export async function endWhatsLeft(ctx: Pick<MutationCtx, "db" | "scheduler">, workspaceId: Id<"workspaces">) {
  const row = await seatSyncRow(ctx, workspaceId);
  if (row) await ctx.db.patch("seatSyncs", row._id, { ending: true });
  else await ctx.db.insert("seatSyncs", { workspaceId, seats: 0, ending: true });
  await ctx.scheduler.runAfter(0, internal.billing.seats.sync, { workspaceId });
}
