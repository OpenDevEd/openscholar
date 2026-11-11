// What ./checks.ts, the action that runs a report's checks, reads before it starts and saves as it goes. Only the
// latest run on the PDF it read counts: a run that a new PDF or a later run replaced saves nothing.
import { v } from "convex/values";
import { internalMutation } from "../lib/functions";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { slugPick } from "../ai/serverModel";
import { actorFor } from "../workspaces/actor";
import { OWNERS_ONLY, checkedDetails, detailsOf, mayChange, touch } from "./flow";
import { RUN_STUCK_MS, changeStageOf, stageOf } from "../../lib/reports/report";
import { seriesOf } from "../../lib/reports/settings";
import { becameReady, notify } from "./mail";
import { SAME_PDF_ADVICE, applyChanges, formVersion } from "./corrections";
import { reportSettings, settingsRow } from "./settings";
import { changeStageValidator, checkResultValidator, checkResultsValidator, checkValidator, metadataValidator, runFromValidator } from "./validators";

/**
 * Starts a run: the author's corrections are saved before anything runs, so a run that fails keeps them, and the
 * report is marked with the run. Answers what the checks need: the report's byline and DOI, its text, and each check
 * that is on with the model it runs on (null when its model has left the catalog).
 */
export const start = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    key: v.string(),
    metadata: metadataValidator,
    runId: v.string(),
    /** What the details were made from: the PDF they were read from, by when it was uploaded, or, for changes to a live report, when its details were last set as the form that made them saw it. */
    from: runFromValidator,
  },
  returns: v.union(v.object({ unchanged: v.literal(true), /** Changes are waiting, which these details don't give up. */ waiting: v.boolean() }), v.object({
    reportId: v.id("reports"),
    doi: v.string(),
    byline: v.string(),
    text: v.union(v.id("_storage"), v.null()),
    version: v.number(),
    checks: v.array(v.object({ ...checkValidator.fields, model: v.union(v.id("models"), v.null()) })),
    changes: v.boolean(),
    /** The PDF whose last page Openscholar added, for a report on its way out: that page is written again with these details. */
    page: v.optional(v.object({ file: v.id("_storage"), at: v.number(), line: v.string(), series: v.string() })),
  })),
  handler: async (ctx, { workspaceId, key, metadata, runId, from }) => {
    const actor = await actorFor(ctx, await requireAuth(ctx), workspaceId);
    const report = await ctx.db.query("reports").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!report || report.workspaceId !== workspaceId) throw createError("NOT_FOUND", "This report isn't one of this workspace's, or it was discarded.");
    if (!mayChange(actor, report)) throw createError("FORBIDDEN", OWNERS_ONLY);
    if (!metadata.title.trim()) throw createError("VALIDATION_ERROR", "Give the report a title before its checks run.");
    const settings = await settingsRow(ctx);
    const details = await detailsOf(ctx, report._id);
    const changes = "changesSince" in from;
    if (changes) {
      // A live report stays as it is while the checks read the corrected details: only the run is marked on it.
      if (report.status !== "live" || report.step !== "done") throw createError("CONFLICT", "This report isn't live any more, so its details can't be changed.");
      // The changes were made from what the form showed when it opened: the report's details, or changes already
      // waiting. Ones made live since, or sent to wait since, from another tab or by a reviewer, would be undone by
      // sending the whole form over them.
      if (formVersion(report, details) !== from.changesSince) throw createError("CONFLICT", "This report's details changed since you opened this form. Open it again to start from them.");
      // One set of changes is checked at a time: a second sent meanwhile, as from another tab, would replace the
      // first without a word to whoever sent it. A run that has gone on too long is given up on, as the page does.
      if (report.run?.changes && Date.now() - report.run.at < RUN_STUCK_MS) throw createError("CONFLICT", "Changes to this report are being checked right now. Send yours once they are done.");
      // Details put back to exactly what the report already says are no changes, and nothing is done about them:
      // changes that are waiting are given up with Discard, never by this. Compared whole, so a change a reader of
      // the page can't see, such as an institution's catalogue ID, still counts as one.
      if (JSON.stringify(details.metadata) === JSON.stringify(checkedDetails(metadata))) return { unchanged: true as const, waiting: details.correction !== undefined };
      // The changes are kept while they are checked, so a run that never ends loses none of them.
      await ctx.db.patch("reportDetails", details._id, { running: [], trying: checkedDetails(metadata) });
      await touch(ctx, report, { run: { id: runId, at: Date.now(), changes: true } });
    } else {
      if (report.step !== "details") throw createError("CONFLICT", "This report isn't waiting for its checks any more.");
      // Details typed over another PDF's, as a tab left open across a new upload would send, are never checked.
      if (report.pdf?.at !== from.pdfAt) throw createError("CONFLICT", "A new PDF replaced the one these details were read from. Check the details it was read into.");
      await ctx.db.patch("reportDetails", details._id, { metadata: checkedDetails(metadata), running: [] });
      await touch(ctx, report, { run: { id: runId, at: Date.now() }, title: metadata.title.trim() });
    }
    // Changes to a live report are checked as it was published: by the checks of that version and against the line
    // its PDF carries, so new checks or a new byline never fail a report published before them.
    const version = changes ? report.checksVersion : settings.checksVersion;
    if (version === undefined) throw createError("CONFLICT", "This report was never checked, so its changes can't be.");
    const checks = changes ? (await ctx.db.query("reportCheckVersions").withIndex("by_version", (q) => q.eq("version", version)).unique())?.checks : settings.checks;
    if (!checks) throw createError("NOT_FOUND", `The checks this report was published under (version ${version}) are missing.`);
    const on = checks.filter((check) => check.enabled);
    return {
      reportId: report._id,
      doi: report.doi,
      byline: report.byline,
      text: report.pdf?.text ?? null,
      version,
      checks: await Promise.all(on.map(async (check) => ({ ...check, model: (await slugPick(ctx, check.modelId, check.effort, "screening"))?.modelId ?? null }))),
      changes,
      ...(!changes && report.pdf?.stamped && { page: { file: report.pdf.file, at: report.pdf.at, line: report.byline, series: seriesOf(report, (await reportSettings(ctx)).series).name } }),
    };
  },
});

/** A run that couldn't go on is given up at once, so its author can run the checks again without waiting for it to be taken for stuck. */
export const abandon = internalMutation({
  args: { reportId: v.id("reports"), runId: v.string() },
  returns: v.null(),
  handler: async (ctx, { reportId, runId }) => {
    const report = await ctx.db.get("reports", reportId);
    if (report?.run?.id === runId) await ctx.db.patch("reports", reportId, { run: undefined });
    return null;
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
 *
 * A run on changes to a live report follows the rule a new report does. Every check passing with review off puts
 * them live at once. Anything else keeps them beside the report, which stays exactly as it was: a check they newly
 * fail is the author's to fix or to ask a person about, and the rest waits for a reviewer, so a report approved over
 * a check's answer is approved by a person again.
 */
export const finish = internalMutation({
  args: { reportId: v.id("reports"), runId: v.string(), results: checkResultsValidator, version: v.number(), /** The changes a run on a live report read. */ metadata: v.optional(metadataValidator) },
  // Where changes to a live report stand after the run: live, or kept beside it at that stage. Null for a first run, or one that was replaced.
  returns: v.union(v.null(), v.literal("live"), changeStageValidator),
  handler: async (ctx, { reportId, runId, results, version, metadata: read }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report || report.run?.id !== runId) return null;
    const details = await detailsOf(ctx, reportId);
    if (report.run.changes) {
      if (report.status !== "live" || !read) return null;
      // As the run kept them when it started: an empty link dropped then is never published, nor counted as a change next time.
      const metadata = checkedDetails(read);
      await ctx.db.patch("reportDetails", details._id, { running: undefined, trying: undefined });
      await ctx.db.patch("reports", reportId, { run: undefined });
      const settings = await reportSettings(ctx);
      if (!settings.humanReview && results.every((result) => result.pass)) {
        await notify(ctx, reportId, "changes-live", { edited: await applyChanges(ctx, (await ctx.db.get("reports", reportId))!, details, { metadata, results, checksVersion: version }) });
        return "live" as const;
      }
      // A check the report passed reads the same PDF now: what it says to do about a new PDF can't be done here.
      const passedBefore = new Set((details.results ?? []).filter((result) => result.pass).map((result) => result.checkId));
      const said = results.map((result) => (!result.pass && result.fix && passedBefore.has(result.checkId) ? { ...result, fix: SAME_PDF_ADVICE } : result));
      // These replace any changes that were waiting: a reviewer sees only the latest.
      await ctx.db.patch("reportDetails", details._id, { correction: { metadata, results: said, checksVersion: version, at: Date.now() } });
      const stage = changeStageOf(details.results, { results: said });
      await touch(ctx, (await ctx.db.get("reports", reportId))!, { changes: stage });
      // The team hears of changes that wait for a reviewer, and of a check that couldn't answer when nothing waits.
      if (stage === "review") await notify(ctx, reportId, "changes-waiting");
      else if (results.some((result) => result.errored)) await notify(ctx, reportId, "check-unfinished");
      return stage;
    }
    if (report.step !== "details") return null;
    await ctx.db.patch("reportDetails", details._id, { results, running: undefined, reviewRequest: undefined });
    await touch(ctx, report, {
      status: results.some((result) => !result.pass && result.blocking) ? "failed" : "passed",
      flagged: results.some((result) => !result.pass) || undefined,
      step: "done",
      run: undefined,
      checksVersion: version,
      approved: undefined,
      asked: undefined,
    });
    // The team hears of a report that waits for a reviewer, and of a check that couldn't answer when nothing waits.
    const checked = (await ctx.db.get("reports", reportId))!;
    const stage = stageOf(checked, (await reportSettings(ctx)).humanReview);
    if (stage === "review") await notify(ctx, reportId, "waiting-for-review");
    else if (results.some((result) => result.errored)) await notify(ctx, reportId, "check-unfinished");
    if (stage === "ready") await becameReady(ctx, reportId);
    return null;
  },
});
