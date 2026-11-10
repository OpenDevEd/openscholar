// Reviewing Openscholar Reports (plans/publish-reports). Reviewers are Openscholar's admins. From Settings > Admin >
// Publishing they read every report, approve, decline, withdraw and reinstate it whatever its checks said, approve
// or decline changes to a live one, and edit a report's details themselves.
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "../lib/functions";
import { requireAdmin } from "../admins/access";
import { refuseApps } from "../lib/auth";
import { createError } from "../lib/errors";
import { personName } from "../lib/people";
import { workspaceFrom } from "../workspaces/personal";
import { REVIEW_TEXT_MAX, STAGES, changesOf, stageOf, wantsReviewer, type Stage } from "../../lib/reports/report";
import { bylineOf } from "../../lib/reports/settings";
import { applyChanges } from "./corrections";
import { detailsOf, keptDetails, signedAgreement, touch } from "./flow";
import { notify } from "./mail";
import { reportSettings } from "./settings";
import { adminReportValidator, adminRowsValidator, metadataValidator, reviewDecisionValidator, signedAgreementValidator, type adminRowValidator } from "./validators";

/** Reports one page of the reviewers' list holds, and the newest of each status the list reads. */
export const REVIEW_PER_PAGE = 8;
const STATUS_READ = 500;
const SHOWS = ["all", "review", ...STAGES.filter((stage) => stage !== "draft" && stage !== "review")] as const;
type Show = (typeof SHOWS)[number];
const showValidator = v.union(...SHOWS.map((show) => v.literal(show)));
const countFields = Object.fromEntries(SHOWS.map((show) => [show, v.number()])) as Record<Show, ReturnType<typeof v.number>>;
const sortValidator = v.union(v.literal("newest"), v.literal("oldest"), v.literal("title"));

const byKey = (ctx: QueryCtx, key: string) => ctx.db.query("reports").withIndex("by_key", (q) => q.eq("key", key)).unique();
const said = (note: string | undefined) => note?.trim().slice(0, REVIEW_TEXT_MAX) || undefined;

async function row(ctx: QueryCtx, report: Doc<"reports">): Promise<Infer<typeof adminRowValidator>> {
  const { key, doi, step, status, approved, flagged, asked, changes, note, registration, deposit, archive, updatedAt } = report;
  // Its first author, with where they work, as the list names a report's people.
  const first = (await detailsOf(ctx, report._id)).metadata?.authors[0];
  return {
    key, doi, step, status, registration, deposit, archive, updatedAt,
    ...(approved && { approved }),
    ...(flagged && { flagged }),
    ...(asked && { asked }),
    ...(changes && { changes }),
    ...(note && { note }),
    ...((report.title ?? report.pdf?.name) && { title: report.title ?? report.pdf?.name }),
    withdrawn: report.withdrawnAt !== undefined,
    signer: report.signedBy.name,
    coverUrl: report.cover ? await ctx.storage.getUrl(report.cover.file) : null,
    ...(report.pdf && { pdfAt: report.pdf.at }),
    ...(first?.name && { first: { name: first.name, ...(first.affiliations[0]?.country && { country: first.affiliations[0].country }) } }),
  };
}

// ponytail: the reviewers' list reads the newest STATUS_READ reports of each status past draft, then filters,
// searches and sorts them in memory, which is what lets it page by number and keep its place in the address. Past
// that many of one status, older ones need a search index and cursor pages.
async function checked(ctx: QueryCtx) {
  const read = await Promise.all((["failed", "passed", "live", "declined"] as const).map((status) => ctx.db.query("reports").withIndex("by_status_and_updatedAt", (q) => q.eq("status", status)).order("desc").take(STATUS_READ)));
  // A report sent back for a new PDF is its author's again until its checks have run.
  return read.flat().filter((report) => report.step === "done");
}

/**
 * One page of the reports reviewers work on: every report whose checks have run. `show` keeps one stage, or those
 * that want a reviewer now (waiting for review, failed with its author asking, live with changes waiting); `q`
 * keeps those whose title, key, DOI or signer holds its words. With how many each filter holds.
 */
export const page = query({
  args: { page: v.number(), show: v.optional(showValidator), sort: v.optional(sortValidator), q: v.optional(v.string()) },
  returns: v.object({ rows: adminRowsValidator, page: v.number(), pages: v.number(), total: v.number(), counts: v.object(countFields), series: v.string(), humanReview: v.boolean() }),
  handler: async (ctx, { page, show = "all", sort = "newest", q }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const { humanReview, series } = await reportSettings(ctx);
    const reports = await checked(ctx);
    const shows = (report: Doc<"reports">, kept: Show) => kept === "all" || (kept === "review" ? wantsReviewer(report, humanReview) : stageOf(report, humanReview) === (kept as Stage));
    const words = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const text = (report: Doc<"reports">) => `${report.title ?? ""} ${report.key} ${report.doi} ${report.signedBy.name}`.toLowerCase();
    const listed = reports
      .filter((report) => shows(report, show))
      .filter((report) => words.every((word) => text(report).includes(word)))
      .sort((a, b) => (sort === "title" ? (a.title ?? "").localeCompare(b.title ?? "") : sort === "oldest" ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt));
    const pages = Math.max(1, Math.ceil(listed.length / REVIEW_PER_PAGE));
    const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
    return {
      rows: await Promise.all(listed.slice((at - 1) * REVIEW_PER_PAGE, at * REVIEW_PER_PAGE).map((report) => row(ctx, report))),
      page: at,
      pages,
      total: listed.length,
      counts: Object.fromEntries(SHOWS.map((kept) => [kept, reports.filter((report) => shows(report, kept)).length])) as Record<Show, number>,
      series: series.name,
      humanReview,
    };
  },
});

/** Most decisions a report's record shows: the latest. */
const REVIEWS_SHOWN = 50;

/** One report as a reviewer reads it: everything its author sees, and the model behind each answer, who it belongs to, and every reviewer's word on it. A draft too, which an email about a PDF that couldn't be read links to. */
export const get = query({
  args: { key: v.string() },
  returns: v.union(adminReportValidator, v.null()),
  handler: async (ctx, { key }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const report = await byKey(ctx, key);
    if (!report) return null;
    const [details, settings, owner, workspace, reviews, emails] = await Promise.all([
      detailsOf(ctx, report._id),
      reportSettings(ctx),
      ctx.db.get("users", report.ownerId),
      workspaceFrom(ctx, report.workspaceId),
      ctx.db.query("reportReviews").withIndex("by_reportId", (q) => q.eq("reportId", report._id)).order("desc").take(REVIEWS_SHOWN),
      ctx.db.query("reportEmails").withIndex("by_reportId", (q) => q.eq("reportId", report._id)).order("desc").take(REVIEWS_SHOWN),
    ]);
    const reviewers = new Map<Id<"users">, string>();
    for (const review of reviews) if (!reviewers.has(review.by)) reviewers.set(review.by, await ctx.db.get("users", review.by).then((user) => (user && personName(user)) || "A reviewer"));
    return {
      ...(await row(ctx, report)),
      byline: bylineOf(settings.series, report.doi),
      owner: { name: (owner && personName(owner)) || "", email: owner?.email ?? "" },
      workspace: workspace.organization ? workspace.name : null,
      signedAt: report.signedAt,
      onBehalfOfAll: report.signedBy.onBehalfOfAll,
      agreementVersion: report.agreementVersion,
      ...(report.checksVersion !== undefined && { checksVersion: report.checksVersion }),
      ...(report.run && { run: { at: report.run.at, changes: report.run.changes === true } }),
      ...(report.pdf && { pdf: { name: report.pdf.name, bytes: report.pdf.bytes, at: report.pdf.at, ...(report.pdf.pages !== undefined && { pages: report.pdf.pages }), ...(report.pdf.trouble && { trouble: report.pdf.trouble }), url: await ctx.storage.getUrl(report.pdf.file) } }),
      ...(details.metadata && { metadata: details.metadata }),
      ...(details.results && { results: details.results }),
      ...(details.reviewRequest && { reviewRequest: details.reviewRequest }),
      ...(details.correction && { correction: details.correction }),
      ...(report.activatedAt !== undefined && { activatedAt: report.activatedAt }),
      ...(report.correctedAt !== undefined && { correctedAt: report.correctedAt }),
      reviews: reviews.reverse().map(({ decision, by, at, note }) => ({ decision, by: reviewers.get(by)!, at, ...(note && { note }) })),
      emails: emails.reverse().map(({ event, audience, at, error }) => ({ event, audience, at, ...(error && { failed: true }) })),
      humanReview: settings.humanReview,
    };
  },
});

const record = (ctx: MutationCtx, reportId: Id<"reports">, by: Id<"users">, decision: Infer<typeof reviewDecisionValidator>, note?: string) =>
  ctx.db.insert("reportReviews", { reportId, decision, by, at: Date.now(), ...(note && { note }) });

/**
 * A reviewer's word on any report, whatever its checks said and whether or not its author asked: approve one that
 * isn't live yet, so its author can activate it, or decline it; withdraw a live one, whose page then says so, since
 * its DOI can't be removed; reinstate a withdrawn one. `seenPdfAt` is the PDF the reviewer had open: a word is never
 * taken for one uploaded since.
 */
export const decide = mutation({
  args: { key: v.string(), decision: v.union(v.literal("approve"), v.literal("decline"), v.literal("withdraw"), v.literal("reinstate")), seenPdfAt: v.optional(v.number()), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { key, decision, seenPdfAt, note }) => {
    await refuseApps(ctx);
    const reviewer = await requireAdmin(ctx);
    const report = await byKey(ctx, key);
    if (!report || report.step !== "done") throw createError("CONFLICT", "This report isn't waiting on a reviewer any more: its author is working on it again.");
    if (report.pdf?.at !== seenPdfAt) throw createError("CONFLICT", "The author uploaded a new PDF since you opened this. It is the one shown now.");
    const stage = stageOf(report, (await reportSettings(ctx)).humanReview);
    const words = said(note);
    if (decision === "reinstate") {
      if (stage !== "declined" || !report.withdrawnAt) throw createError("CONFLICT", "Only a withdrawn report can be reinstated.");
      await touch(ctx, report, { status: "live", withdrawnAt: undefined, note: undefined });
      await record(ctx, report._id, reviewer._id, "reinstate");
      await notify(ctx, report._id, "reinstated");
      return null;
    }
    if (stage === "declined") throw createError("CONFLICT", report.withdrawnAt ? "This report was already withdrawn." : "This report was already declined.");
    // Withdrawing is a live report's and declining is one not yet live: a word given for the one never becomes the
    // other because the report went live, or was withdrawn, since the reviewer opened it.
    if (decision === "withdraw") {
      if (stage !== "live") throw createError("CONFLICT", "This report isn't live, so there is nothing to withdraw.");
      await touch(ctx, report, { status: "declined", withdrawnAt: Date.now(), note: words });
      await record(ctx, report._id, reviewer._id, "withdraw", words);
      await notify(ctx, report._id, "withdrawn");
      return null;
    }
    if (stage === "live") throw createError("CONFLICT", "This report went live since you opened it. Withdraw it if it shouldn't be.");
    if (decision === "approve") {
      if (stage !== "failed" && stage !== "review") throw createError("CONFLICT", "This report doesn't need approving any more. Its author can activate it.");
      // Approving lets the author activate it; the author decides when it goes live.
      await touch(ctx, report, { approved: true });
      await record(ctx, report._id, reviewer._id, "approve");
      await notify(ctx, report._id, "approved");
      return null;
    }
    await touch(ctx, report, { status: "declined", note: words });
    await record(ctx, report._id, reviewer._id, "decline", words);
    await notify(ctx, report._id, "declined");
    return null;
  },
});

/**
 * A reviewer's word on changes to a live report: approving puts them live and registers the report again, declining
 * keeps them for the author to change or discard. The report itself stays live either way. `seenAt` names the
 * changes the reviewer read, so changes the author has since replaced are never the ones decided.
 */
export const decideChanges = mutation({
  args: { key: v.string(), decision: v.union(v.literal("approve"), v.literal("decline")), seenAt: v.number(), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { key, decision, seenAt, note }) => {
    await refuseApps(ctx);
    const reviewer = await requireAdmin(ctx);
    const report = await byKey(ctx, key);
    const details = report ? await detailsOf(ctx, report._id) : null;
    const waiting = report?.status === "live" ? details?.correction : undefined;
    if (!report || !details || !waiting || waiting.declined) throw createError("CONFLICT", "These changes aren't waiting any more.");
    if (waiting.at !== seenAt) throw createError("CONFLICT", "The author changed the details again since you opened this. Those are the ones shown now.");
    if (decision === "approve") {
      await applyChanges(ctx, report, details, waiting);
      await record(ctx, report._id, reviewer._id, "approve-changes");
      await notify(ctx, report._id, "changes-live");
      return null;
    }
    const words = said(note);
    await ctx.db.patch("reportDetails", details._id, { correction: { ...waiting, declined: { at: Date.now(), ...(words && { note: words }) } } });
    await touch(ctx, report, { changes: "declined" });
    await record(ctx, report._id, reviewer._id, "decline-changes", words);
    await notify(ctx, report._id, "changes-declined");
    return null;
  },
});

/**
 * A reviewer edits a checked report's details themselves, to fix what isn't worth sending back to its author. The
 * edit is the report's at once: a live report registers again, so Crossref and Zenodo hold it too. Who edited, and
 * when, stays with the report. Not while the author's own changes are waiting: those are approved or declined
 * first, so neither set overwrites the other. Answers what changed, field by field.
 */
export const editDetails = mutation({
  args: { key: v.string(), seenAt: v.number(), metadata: metadataValidator },
  returns: v.string(),
  handler: async (ctx, { key, seenAt, metadata }) => {
    await refuseApps(ctx);
    const reviewer = await requireAdmin(ctx);
    const report = await byKey(ctx, key);
    const details = report ? await detailsOf(ctx, report._id) : null;
    if (!report || !details?.metadata || report.step !== "done") throw createError("CONFLICT", "This report's details aren't a reviewer's to edit yet: its author is still working on it.");
    if (!metadata.title.trim()) throw createError("VALIDATION_ERROR", "The report needs a title.");
    if (details.correction) throw createError("CONFLICT", "The author's changes to this report are waiting. Approve or decline them first.");
    // The edit was made from the report as it stood when the form opened: one changed since, or being checked now,
    // is never overwritten by it.
    if (report.run) throw createError("CONFLICT", "This report's checks are running on a change right now. Try again in a moment.");
    if (report.updatedAt !== seenAt) throw createError("CONFLICT", "This report changed since you opened it. Open it again to edit it as it stands.");
    const kept = keptDetails(metadata);
    if (JSON.stringify(details.metadata) === JSON.stringify(kept)) throw createError("VALIDATION_ERROR", "Nothing was changed.");
    const changed = changesOf(details.metadata, kept).map((change) => change.label).join(", ");
    if (report.status === "live") await applyChanges(ctx, report, details, { metadata: kept, results: details.results ?? [], checksVersion: report.checksVersion ?? (await reportSettings(ctx)).checksVersion });
    else {
      await ctx.db.patch("reportDetails", details._id, { metadata: kept });
      await touch(ctx, report, { title: kept.title.trim() });
    }
    await record(ctx, report._id, reviewer._id, "edit", changed.slice(0, REVIEW_TEXT_MAX));
    await notify(ctx, report._id, "details-edited", changed.slice(0, REVIEW_TEXT_MAX));
    return changed;
  },
});

/** Reports one step of a release takes. */
const RELEASED_PER_STEP = 50;

/**
 * Review switched off releases the changes that waited only for it: ones their author already sent and every check
 * passed go live. (A report waiting for review needs nothing done: `stageOf` makes it its author's to activate.)
 * A step at a time, until none is left.
 */
export const release = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if ((await reportSettings(ctx)).humanReview) return null;
    const waiting = await ctx.db.query("reports").withIndex("by_changes", (q) => q.eq("changes", "review")).take(RELEASED_PER_STEP);
    let released = 0;
    for (const report of waiting) {
      const details = await detailsOf(ctx, report._id);
      const changes = details.correction;
      // Changes a check failed wait on a person whatever the setting says.
      if (report.status !== "live" || !changes || changes.declined || changes.results.some((result) => !result.pass)) continue;
      await applyChanges(ctx, report, details, changes);
      await notify(ctx, report._id, "changes-live");
      released += 1;
    }
    // Those released left the index's range; the rest of this step stay, so a full step with any released has more behind it.
    if (waiting.length === RELEASED_PER_STEP && released > 0) await ctx.scheduler.runAfter(0, internal.reports.review.release, {});
    return null;
  },
});

/**
 * Tells the authors whose reports waited only for a reviewer that they can activate them now, once review is
 * switched off. ponytail: the newest RELEASED_PER_STEP passed reports are told; with more than that waiting, the
 * older ones find out on Publish. Page through them if that ever happens.
 */
export const tellReleased = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if ((await reportSettings(ctx)).humanReview) return null;
    const passed = await ctx.db.query("reports").withIndex("by_status_and_updatedAt", (q) => q.eq("status", "passed")).order("desc").take(RELEASED_PER_STEP);
    // One a reviewer approved was already its author's to activate, and one a check flagged still waits for a person.
    for (const report of passed) if (!report.approved && !report.flagged) await notify(ctx, report._id, "released");
    return null;
  },
});

/** The agreement a report's author signed, for a reviewer: what its workspace reads at the same address (./flow.ts `agreement`). */
export const agreement = query({
  args: { key: v.string() },
  returns: v.union(v.null(), signedAgreementValidator),
  handler: async (ctx, { key }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const report = await byKey(ctx, key);
    return report ? await signedAgreement(ctx, report) : null;
  },
});
