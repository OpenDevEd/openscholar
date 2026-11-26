/**
 * The few facts of a paper that a screening's lists are narrowed by, kept as a small row beside it: where it stands,
 * the source and the check that brought it, why it is excluded, and whether its source was taken out. A paper's own
 * row holds its abstract, and a few thousand of those are more than one read may hold. These are not, so how many
 * papers stand each way under any narrowing is one read (./paperViews.ts `counts`).
 *
 * This module holds no Convex functions, so the triggers can load it.
 */
import type { Change } from "convex-helpers/server/triggers";
import type { DataModel, Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const FACTS = ["result", "sourceId", "checkId", "reason", "withdrawn"] as const satisfies ReadonlyArray<keyof Doc<"screeningResults">>;

/** The trigger that keeps a paper's card in step with it. Only a paper of a screening with reviewers has a place, and a card. */
export async function keepCard(ctx: MutationCtx, change: Change<DataModel, "screeningResults">) {
  const [was, now] = [change.oldDoc, change.newDoc];
  const held = was?.place === undefined ? null : await ctx.db.query("screeningCards").withIndex("by_result", (q) => q.eq("resultId", change.id)).unique();
  if (!now || now.place === undefined) {
    if (held) await ctx.db.delete("screeningCards", held._id);
    return;
  }
  if (held && FACTS.every((fact) => was![fact] === now[fact])) return;
  const card = { jobId: now.jobId, resultId: now._id, result: now.result ?? ("waiting" as const), ...(now.sourceId ? { sourceId: now.sourceId } : {}), ...(now.checkId ? { checkId: now.checkId } : {}), ...(now.reason ? { reason: now.reason } : {}), ...(now.withdrawn ? { withdrawn: true as const } : {}) };
  if (held) await ctx.db.replace("screeningCards", held._id, card);
  else await ctx.db.insert("screeningCards", card);
}
