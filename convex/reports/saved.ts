// A report's saved copies (OpenDevEd/openalex-count#1219). A paper saved to a library or a collection is a snapshot,
// and a report changes after it is saved: its author corrects it, a reviewer edits or withdraws it. Its copies in
// every workspace are brought in step here, a page at a time. In a module of its own: the paper it builds reads the
// topic catalogue, which no other report function should load.
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "../lib/functions";
import { libraryPaper } from "../library/validators";
import { MAX_AUTHORS } from "../lib/listCaps";
import { trimPaperData } from "../../lib/library/trim-paper-data";
import { reportPaper } from "../../lib/reports/report-paper";
import { readersGetFile } from "../../lib/reports/report";
import { seriesOf } from "../../lib/reports/settings";
import { detailsOf } from "./flow";
import { reportSettings } from "./settings";

/**
 * Saved copies one step brings in step. A copy of the largest report a details form allows is about half a megabyte
 * (its paper, with every author's affiliations, beside the abstract and the names it also keeps on their own), and a
 * step reads each copy and writes it again inside Convex's 16 MiB a transaction: eight stay well inside it.
 */
const COPIES_PER_STEP = 8;

/**
 * Saves a report that has just gone live to the library of the workspace it was published in, as its owner pressing
 * Add to library on its page would. Scheduled by the write that makes it live.
 */
export const keep = internalMutation({
  args: { reportId: v.id("reports") },
  returns: v.null(),
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get("reports", reportId);
    const copy = report?.status === "live" ? await copyOf(ctx, report) : null;
    if (!copy) return null;
    await ctx.runMutation(internal.library.mutations.saveRead, { userId: report!.ownerId, workspaceId: report!.workspaceId, paper: copy, author: "user" });
    return null;
  },
});

/**
 * A report's saved copy as saving it now keeps it, from the report as it stands: a live one's details; a withdrawn
 * one's title says so, and its PDF is no longer offered. Null for a report that never went live: it has no page, and
 * nothing may save it.
 */
async function copyOf(ctx: QueryCtx, report: Doc<"reports">): Promise<Infer<typeof libraryPaper> | null> {
  if (report.status !== "live" && report.withdrawnAt === undefined) return null;
  const { metadata } = await detailsOf(ctx, report._id);
  if (!metadata) return null;
  const live = report.status === "live";
  const { series } = await reportSettings(ctx);
  const paper = reportPaper({ key: report.key, doi: report.doi, pdfUrl: live && readersGetFile(report) ? "its own address" : null, updatedAt: report.updatedAt }, metadata, seriesOf(report, series));
  // ponytail: a withdrawn copy is told apart by its title alone; give library cards a mark of their own if more is wanted.
  const work = live ? paper : { ...paper, title: `Withdrawn: ${paper.title}`, display_name: `Withdrawn: ${paper.title}`, open_access: { is_oa: false, oa_status: "closed", oa_url: null } };
  return { ...trimPaperData(work), paper: `report:${report.key}`, paperData: JSON.stringify(work) };
}

/**
 * A report's saved copy by its key, which every save of it keeps whatever the page or the assistant sent
 * (library/mutations.ts `upsertLibraryItem`): the same item, with the same details, however it was saved. Null for a
 * key that never went live.
 */
export const copy = internalQuery({
  args: { key: v.string() },
  returns: v.union(libraryPaper, v.null()),
  handler: async (ctx, { key }) => {
    const report = await ctx.db.query("reports").withIndex("by_key", (q) => q.eq("key", key)).unique();
    return report ? await copyOf(ctx, report) : null;
  },
});

/**
 * Rewrites a report's saved copies from the report as it stands (`copyOf`). Each step takes one page and schedules
 * the next, however many workspaces saved it. A person's rating and their collections are theirs and stay.
 */
export const follow = internalMutation({
  args: { reportId: v.id("reports"), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { reportId, cursor = null }) => {
    const report = await ctx.db.get("reports", reportId);
    const copy = report && (await copyOf(ctx, report));
    if (!copy) return null;
    const { paper: _key, crossRefs: _refs, authors = [], ...kept } = copy;
    const named = authors.length > MAX_AUTHORS ? { authors: undefined, authorsUnparsed: authors.join(", ") } : { authors, authorsUnparsed: undefined };
    const fields = { ...kept, ...named, searchableText: [kept.title, kept.abstract, authors.join(", ")].filter(Boolean).join(" ") };
    const copies = await ctx.db.query("libraryItems").withIndex("by_paperKey", (q) => q.eq("paperKey", copy.paper)).paginate({ cursor, numItems: COPIES_PER_STEP });
    const now = Date.now();
    for (const saved of copies.page) await ctx.db.patch("libraryItems", saved._id, { ...fields, updatedAt: now });
    if (!copies.isDone) await ctx.scheduler.runAfter(0, internal.reports.saved.follow, { reportId, cursor: copies.continueCursor });
    return null;
  },
});

/** Reports one step of `followAll` reads. */
const REPORTS_PER_STEP = 100;

/** Every published report's saved copies follow the series, after its name or ISSN changed: a page of reports a step. */
export const followAll = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor = null }) => {
    const reports = await ctx.db.query("reports").paginate({ cursor, numItems: REPORTS_PER_STEP });
    for (const report of reports.page) {
      if (report.status === "live" || report.withdrawnAt !== undefined) await ctx.scheduler.runAfter(0, internal.reports.saved.follow, { reportId: report._id });
    }
    if (!reports.isDone) await ctx.scheduler.runAfter(0, internal.reports.saved.followAll, { cursor: reports.continueCursor });
    return null;
  },
});
