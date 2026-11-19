// A withdrawn report's files (plans/publish-reports). A file in Convex storage keeps one address for as long as it
// exists, and a live report's PDF and cover were handed to everyone who read its page. When the report is withdrawn
// each is stored again under a new address and the old file is deleted, so the addresses already out stop working.
import { v } from "convex/values";
import { fileAccessOf, fileHidden, licenceOf } from "../../lib/reports/report";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "../lib/functions";

const pairValidator = v.object({ from: v.id("_storage"), to: v.id("_storage") });

/** The files a withdrawn report, or one whose file readers may no longer have, still holds under the addresses it was read by. */
export const held = internalQuery({
  args: { reportId: v.id("reports") },
  returns: v.union(v.null(), v.object({ pdf: v.optional(v.id("_storage")), cover: v.optional(v.id("_storage")) })),
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report || (report.withdrawnAt === undefined && !fileHidden(fileAccessOf(licenceOf(report), report.fileAccess)))) return null;
    return { ...(report.pdf && { pdf: report.pdf.file }), ...(report.cover && { cover: report.cover.file }) };
  },
});

/** Puts the copies in the report's place and deletes what they replace. A file changed meanwhile keeps its own, and its copy is deleted instead. */
export const swap = internalMutation({
  args: { reportId: v.id("reports"), pdf: v.optional(pairValidator), cover: v.optional(pairValidator) },
  returns: v.null(),
  handler: async (ctx, { reportId, pdf, cover }) => {
    const report = await ctx.db.get("reports", reportId);
    const take = async (pair: { from: Id<"_storage">; to: Id<"_storage"> } | undefined, held: Id<"_storage"> | undefined) => {
      if (!pair) return false;
      if (!report || held !== pair.from) return void (await ctx.storage.delete(pair.to)), false;
      const claim = await ctx.db.query("reportFiles").withIndex("by_file", (q) => q.eq("file", pair.from)).unique();
      if (claim) await ctx.db.patch("reportFiles", claim._id, { file: pair.to });
      await ctx.storage.delete(pair.from);
      return true;
    };
    const newPdf = await take(pdf, report?.pdf?.file);
    const newCover = await take(cover, report?.cover?.file);
    if (report && (newPdf || newCover)) {
      await ctx.db.patch("reports", reportId, {
        ...(newPdf && report.pdf && { pdf: { ...report.pdf, file: pdf!.to } }),
        ...(newCover && report.cover && { cover: { ...report.cover, file: cover!.to } }),
      });
    }
    return null;
  },
});

/** Stores a withdrawn report's PDF and cover again, so the addresses they were read by stop working. */
export const rotate = internalAction({
  args: { reportId: v.id("reports") },
  returns: v.null(),
  handler: async (ctx, { reportId }) => {
    const files = await ctx.runQuery(internal.reports.files.held, { reportId });
    if (!files) return null;
    const copy = async (from: Id<"_storage"> | undefined) => {
      const blob = from && (await ctx.storage.get(from));
      return from && blob ? { from, to: await ctx.storage.store(blob) } : undefined;
    };
    const [pdf, cover] = [await copy(files.pdf), await copy(files.cover)];
    await ctx.runMutation(internal.reports.files.swap, { reportId, ...(pdf && { pdf }), ...(cover && { cover }) });
    return null;
  },
});
