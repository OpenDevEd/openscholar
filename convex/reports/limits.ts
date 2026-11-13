// How many reports a workspace may start in a day (plans/publish-reports, #1261): its plan's `reports_per_day` in
// Autumn. A start counts for 24 hours whatever becomes of the report, so a number raised today opens that many more today.
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../lib/functions";
import { planLimit } from "../billing/accounts";
import { createError } from "../lib/errors";
import { DAY_MS, MAX_DAILY_LIMIT, startWords, type WorkspaceKind } from "../../lib/reports/settings";

async function kindOf(ctx: QueryCtx, workspaceId: Id<"workspaces">): Promise<WorkspaceKind> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) throw createError("NOT_FOUND", "Workspace not found");
  return workspace.kind;
}

/** The new reports a day the workspace's plan allows, and how many are left at `now`. Null for a plan that sets none. */
export async function startsLeft(ctx: QueryCtx, workspaceId: Id<"workspaces">, now: number): Promise<{ kind: WorkspaceKind; perDay: number | null; left: number | null }> {
  const kind = await kindOf(ctx, workspaceId);
  const perDay = (await planLimit(ctx, workspaceId, "reports_per_day")) ?? null;
  if (perDay === null) return { kind, perDay, left: null };
  // Only as many as the limit are read: one more start than that changes nothing.
  const started = await ctx.db.query("reportStarts").withIndex("by_workspaceId_and_at", (q) => q.eq("workspaceId", workspaceId).gt("at", now - DAY_MS)).take(Math.min(perDay, MAX_DAILY_LIMIT));
  return { kind, perDay, left: Math.max(0, perDay - started.length) };
}

/** Counts a report started in a workspace now, refusing when its plan's day is used up. The caller has checked the person may act there. */
export async function countStart(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const now = Date.now();
  const { kind, perDay, left } = await startsLeft(ctx, workspaceId, now);
  if (perDay !== null && left === 0) throw createError("FORBIDDEN", startWords(perDay, kind));
  await ctx.db.insert("reportStarts", { workspaceId, at: now });
}
