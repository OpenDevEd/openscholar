// A report's saved copies (OpenDevEd/openalex-count#1219). A paper saved to a library or a collection is a snapshot,
// and a report changes after it is saved: its author corrects it, a reviewer edits or withdraws it. Its copies in
// every workspace are brought in step here, a page at a time. In a module of its own: the paper it builds reads the
// topic catalogue, which no other report function should load.
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../lib/functions";
import { MAX_AUTHORS } from "../lib/listCaps";
import { trimPaperData } from "../../lib/library/trim-paper-data";
import { reportPaper } from "../../lib/reports/report-paper";
import { detailsOf } from "./flow";
import { reportSettings } from "./settings";

/** Saved copies one step brings in step. */
const COPIES_PER_STEP = 50;

/**
 * Rewrites a report's saved copies from the report as it stands: a live one's details, as saving it now would keep
 * them; a withdrawn one's title says so, and its PDF is no longer offered. Each step takes one page and schedules
 * the next, however many workspaces saved it. A person's rating and their collections are theirs and stay.
 */
export const follow = internalMutation({
  args: { reportId: v.id("reports"), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { reportId, cursor = null }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report) return null;
    const { metadata } = await detailsOf(ctx, reportId);
    // Never live, it has no page and nothing saved it.
    if (!metadata || (report.status !== "live" && report.withdrawnAt === undefined)) return null;
    const live = report.status === "live";
    const { series } = await reportSettings(ctx);
    const paper = reportPaper({ key: report.key, doi: report.doi, pdfUrl: live && report.pdf ? "its own address" : null, updatedAt: report.updatedAt }, metadata, series);
    // ponytail: a withdrawn copy is told apart by its title alone; give library cards a mark of their own if more is wanted.
    const work = live ? paper : { ...paper, title: `Withdrawn: ${paper.title}`, display_name: `Withdrawn: ${paper.title}`, open_access: { is_oa: false, oa_status: "closed", oa_url: null } };
    const { paper: _id, authors = [], ...kept } = trimPaperData(work);
    const named = authors.length > MAX_AUTHORS ? { authors: undefined, authorsUnparsed: authors.join(", ") } : { authors, authorsUnparsed: undefined };
    const fields = { ...kept, ...named, paperData: JSON.stringify(work), searchableText: [kept.title, kept.abstract, authors.join(", ")].filter(Boolean).join(" ") };
    const copies = await ctx.db.query("libraryItems").withIndex("by_paperKey", (q) => q.eq("paperKey", `report:${report.key}`)).paginate({ cursor, numItems: COPIES_PER_STEP });
    const now = Date.now();
    for (const copy of copies.page) await ctx.db.patch("libraryItems", copy._id, { ...fields, updatedAt: now });
    if (!copies.isDone) await ctx.scheduler.runAfter(0, internal.reports.saved.follow, { reportId, cursor: copies.continueCursor });
    return null;
  },
});
