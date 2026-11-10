// What ./reading.ts, the action that reads an uploaded PDF, reads before it starts and saves when it's done.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../lib/functions";
import { slugPick } from "../ai/serverModel";
import { effortValidator } from "../aiModelConfig/validators";
import { detailsOf, keptDetails, touch } from "./flow";
import { reportSettings } from "./settings";
import { metadataValidator } from "./validators";

/** The PDF to read and the model that reads it; null when a newer PDF replaced it or the report is past its details. */
export const begin = internalQuery({
  args: { reportId: v.id("reports"), at: v.number() },
  returns: v.union(v.null(), v.object({ file: v.id("_storage"), name: v.string(), doi: v.string(), signer: v.string(), modelId: v.union(v.id("models"), v.null()), effort: v.optional(effortValidator) })),
  handler: async (ctx, { reportId, at }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report?.pdf || report.pdf.at !== at || report.step === "done") return null;
    const settings = await reportSettings(ctx);
    const pick = await slugPick(ctx, settings.metadataModelId, settings.metadataEffort, "extraction");
    return { file: report.pdf.file, name: report.pdf.name, doi: report.doi, signer: report.signedBy.name, modelId: pick?.modelId ?? null, ...(pick?.effort && { effort: pick.effort }) };
  },
});

/**
 * What a reading found: the PDF's pages and text, and its details for the author to correct. A PDF that couldn't be
 * opened stays at the upload step with its trouble said; one whose details couldn't be read opens them to be filled
 * in. A reading of a PDF replaced meanwhile saves nothing, and its text is given up.
 */
export const finish = internalMutation({
  args: { reportId: v.id("reports"), at: v.number(), pages: v.optional(v.number()), text: v.optional(v.id("_storage")), metadata: v.optional(metadataValidator), read: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { reportId, at, pages, text, metadata, read }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report?.pdf || report.pdf.at !== at || report.step === "done") {
      if (text) await ctx.storage.delete(text);
      return null;
    }
    if (!metadata) {
      await touch(ctx, report, { pdf: { ...report.pdf, trouble: "unopened" } });
      return null;
    }
    await ctx.db.patch("reportDetails", (await detailsOf(ctx, reportId))._id, { metadata: keptDetails(metadata) });
    await touch(ctx, report, { pdf: { ...report.pdf, pages, text, ...(read ? {} : { trouble: "unread" as const }) }, step: "details", title: metadata.title.trim() || undefined });
    return null;
  },
});
