// Test support for starting an extraction from picks (#690). The `.test-support.ts` extension keeps it out of the Convex bundle.
import type { TestConvex } from "convex-test";
import type { Id } from "../_generated/dataModel";
import type schema from "../schema";
import { personalWorkspaceOf } from "../workspaces/personal";

/**
 * Papers `first` to `last` of the person's saved papers, as an extraction's pick, with their
 * library counted as holding `count`: a start counts a range by the library's count.
 */
export async function savedPapersPick(t: TestConvex<typeof schema>, userId: Id<"users">, count: number, { first = 1, last = count }: { first?: number; last?: number } = {}) {
  await t.run(async (ctx) => {
    const workspaceId = await personalWorkspaceOf(ctx, userId);
    const row = await ctx.db.query("libraryCounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
    if (row) await ctx.db.patch("libraryCounts", row._id, { count });
    else await ctx.db.insert("libraryCounts", { workspaceId, count });
  });
  return { set: { kind: "saved" as const }, first, last };
}
