// What ./checks.ts, the action that runs a report's checks, reads before it starts and saves as it goes. Only the
// latest run on the PDF it read counts: a run that a new PDF or a later run replaced saves nothing.
import { v } from "convex/values";
import { internalMutation } from "../lib/functions";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { slugPick } from "../ai/serverModel";
import { actorFor } from "../workspaces/actor";
import { bylineOf } from "../../lib/reports/settings";
import { OWNERS_ONLY, detailsOf, keptDetails, mayChange, touch } from "./flow";
import { settingsRow } from "./settings";
import { checkResultValidator, checkResultsValidator, checkValidator, metadataValidator } from "./validators";

/**
 * Starts a run: the author's corrections are saved before anything runs, so a run that fails keeps them, and the
 * report is marked with the run. Answers what the checks need: the report's byline and DOI, its text, and each check
 * that is on with the model it runs on (null when its model has left the catalog).
 */
export const start = internalMutation({
  args: { workspaceId: v.id("workspaces"), key: v.string(), metadata: metadataValidator, runId: v.string(), /** The PDF the details were read from, by when it was uploaded. */ pdfAt: v.number() },
  returns: v.object({
    reportId: v.id("reports"),
    doi: v.string(),
    byline: v.string(),
    text: v.union(v.id("_storage"), v.null()),
    version: v.number(),
    checks: v.array(v.object({ ...checkValidator.fields, model: v.union(v.id("models"), v.null()) })),
  }),
  handler: async (ctx, { workspaceId, key, metadata, runId, pdfAt }) => {
    const actor = await actorFor(ctx, await requireAuth(ctx), workspaceId);
    const report = await ctx.db.query("reports").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!report || report.workspaceId !== workspaceId) throw createError("NOT_FOUND", "This report isn't one of this workspace's, or it was discarded.");
    if (!mayChange(actor, report)) throw createError("FORBIDDEN", OWNERS_ONLY);
    if (report.step !== "details") throw createError("CONFLICT", "This report isn't waiting for its checks any more.");
    // Details typed over another PDF's, as a tab left open across a new upload would send, are never checked.
    if (report.pdf?.at !== pdfAt) throw createError("CONFLICT", "A new PDF replaced the one these details were read from. Check the details it was read into.");
    if (!metadata.title.trim()) throw createError("VALIDATION_ERROR", "Give the report a title before its checks run.");
    const settings = await settingsRow(ctx);
    await ctx.db.patch("reportDetails", (await detailsOf(ctx, report._id))._id, { metadata: keptDetails(metadata), running: [] });
    await touch(ctx, report, { run: { id: runId, at: Date.now() }, title: metadata.title.trim() });
    const on = settings.checks.filter((check) => check.enabled);
    return {
      reportId: report._id,
      doi: report.doi,
      byline: bylineOf(settings.series, report.doi),
      text: report.pdf?.text ?? null,
      version: settings.checksVersion,
      checks: await Promise.all(on.map(async (check) => ({ ...check, model: (await slugPick(ctx, check.modelId, check.effort, "screening"))?.modelId ?? null }))),
    };
  },
});

/** One check's answer, shown to the author as it arrives. */
export const answer = internalMutation({
  args: { reportId: v.id("reports"), runId: v.string(), result: checkResultValidator },
  returns: v.null(),
  handler: async (ctx, { reportId, runId, result }) => {
    const report = await ctx.db.get("reports", reportId);
    if (report?.run?.id !== runId) return null;
    const details = await detailsOf(ctx, reportId);
    await ctx.db.patch("reportDetails", details._id, { running: [...(details.running ?? []).filter((kept) => kept.checkId !== result.checkId), result] });
    return null;
  },
});

/**
 * Saves a run's answers with the version that ran, and decides what happens to the report. Passing makes the report;
 * whether it waits for a reviewer is decided when it's looked at (`stageOf`). A reviewer's approval and the author's
 * request were about the details and answers before these.
 */
export const finish = internalMutation({
  args: { reportId: v.id("reports"), runId: v.string(), results: checkResultsValidator, version: v.number() },
  returns: v.null(),
  handler: async (ctx, { reportId, runId, results, version }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report || report.run?.id !== runId || report.step !== "details") return null;
    await ctx.db.patch("reportDetails", (await detailsOf(ctx, reportId))._id, { results, running: undefined, reviewRequest: undefined });
    await touch(ctx, report, {
      status: results.some((result) => !result.pass && result.blocking) ? "failed" : "passed",
      flagged: results.some((result) => !result.pass) || undefined,
      step: "done",
      run: undefined,
      checksVersion: version,
      approved: undefined,
      asked: undefined,
    });
    return null;
  },
});
