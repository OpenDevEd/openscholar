// What ./reading.ts, the action that reads an uploaded PDF, reads before it starts and saves when it's done.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../lib/functions";
import { slugPick } from "../ai/serverModel";
import { effortValidator } from "../aiModelConfig/validators";
import { detailsOf, forget, keptDetails, touch } from "./flow";
import { notify } from "./mail";
import { reportSettings } from "./settings";
import { seriesOf } from "../../lib/reports/settings";
import { metadataValidator } from "./validators";
import type { Doc } from "../_generated/dataModel";
import type { Metadata } from "../../lib/reports/report";

/** The PDF to read and the model that reads it; null when a newer PDF replaced it or the report is past its details. */
export const begin = internalQuery({
  args: { reportId: v.id("reports"), at: v.number() },
  returns: v.union(v.null(), v.object({ file: v.id("_storage"), name: v.string(), doi: v.string(), signer: v.string(), /** The report's byline, and whether its author has Openscholar add it to the PDF on a last page. */ line: v.string(), added: v.boolean(), /** Its last page is one Openscholar added before. */ stamped: v.boolean(), /** The series the report is published in, and the details it keeps, which that page prints. */ series: v.string(), held: v.optional(metadataValidator), /** The line the byline check looks for in the PDF; null while that check is switched off. */ byline: v.union(v.string(), v.null()), modelId: v.union(v.id("models"), v.null()), effort: v.optional(effortValidator), /** The report has details already, from the PDF this one replaces: they are kept, and this one's aren't read. */ kept: v.boolean() })),
  handler: async (ctx, { reportId, at }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report?.pdf || report.pdf.at !== at || report.step === "done") return null;
    const settings = await reportSettings(ctx);
    const pick = await slugPick(ctx, settings.metadataModelId, settings.metadataEffort, "extraction");
    const held = (await detailsOf(ctx, reportId)).metadata;
    const kept = held !== undefined;
    return { file: report.pdf.file, name: report.pdf.name, doi: report.doi, signer: report.signedBy.name, line: report.byline, added: report.pdf.bylineBy === "added", stamped: !!report.pdf.stamped, series: seriesOf(report, settings.series).name, ...(held && { held }), byline: settings.checks.some((check) => check.id === "byline" && check.enabled) ? report.byline : null, modelId: pick?.modelId ?? null, ...(pick?.effort && { effort: pick.effort }), kept };
  },
});

/**
 * What a reading found: the PDF's pages and text, and its details for the author to correct. A PDF that couldn't be
 * opened stays at the upload step with its trouble said; one with no text in it, or whose details couldn't be read,
 * opens them to be filled in and says so. A reading of a PDF replaced meanwhile saves nothing, and its text is given up.
 */
const sameName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The signer's own author row, matched by the name they signed with, takes the ORCID iD and institutions their profile
 * holds where the PDF gave none: their own iD also comes before one ORCID's search found (`orcidFound`). Nothing the PDF
 * printed is changed, nor anyone else's row, and the author can still edit both.
 */
function signerFilledIn(metadata: Metadata, signer: string, profile: Doc<"users">["profile"]): Metadata {
  if (!profile) return metadata;
  const at = metadata.authors.findIndex((author) => sameName(author.name) === sameName(signer));
  if (at < 0) return metadata;
  const authors = metadata.authors.map((author, index) =>
    index !== at
      ? author
      : {
          ...author,
          ...((!author.orcid || author.orcidFound) && profile.orcid && { orcid: profile.orcid, orcidFound: undefined }),
          ...(!author.affiliations.length && profile.affiliations.length && { affiliations: profile.affiliations }),
        },
  );
  return { ...metadata, authors };
}

export const finish = internalMutation({
  args: { reportId: v.id("reports"), at: v.number(), pages: v.optional(v.number()), text: v.optional(v.id("_storage")), metadata: v.optional(metadataValidator), trouble: v.optional(v.union(v.literal("textless"), v.literal("unread"))), /** Its text doesn't carry the byline: the report stays at the upload, which says so, with the way on to its details. */ lacksByline: v.optional(v.boolean()), /** The details couldn't be read from it, whatever else is wrong with it. */ unread: v.optional(v.boolean()), /** The PDF with the byline's page added, which replaces the one uploaded. */ withByline: v.optional(v.object({ file: v.id("_storage"), bytes: v.number() })) },
  returns: v.null(),
  handler: async (ctx, { reportId, at, pages, text, metadata, trouble, lacksByline, unread, withByline }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report?.pdf || report.pdf.at !== at || report.step === "done") {
      if (text) await ctx.storage.delete(text);
      if (withByline) await ctx.storage.delete(withByline.file);
      return null;
    }
    // The PDF with the byline's page added takes the place of the one uploaded.
    const pdf = withByline ? { ...report.pdf, ...withByline, stamped: true } : report.pdf;
    if (withByline) {
      await forget(ctx, report.pdf.file);
      await ctx.db.insert("reportFiles", { file: withByline.file, reportId });
    }
    const details = await detailsOf(ctx, reportId);
    // Details the report already has, from the PDF this one replaces, stay as their author left them.
    const held = details.metadata;
    // A PDF that couldn't be opened has no pages.
    if (pages === undefined || (!metadata && !held)) {
      await touch(ctx, report, { pdf: { ...pdf, trouble: "unopened" } });
      await notify(ctx, reportId, "pdf-unopened");
      return null;
    }
    if (text) await ctx.db.insert("reportFiles", { file: text, reportId });
    const profile = (await ctx.db.get("users", report.ownerId))?.profile;
    const kept = held ?? keptDetails(signerFilledIn(metadata!, report.signedBy.name, profile));
    if (!held) await ctx.db.patch("reportDetails", details._id, { metadata: kept });
    // An author who went back to the DOI while the PDF was being read stays there: the reading moves on only a
    // report still waiting at its upload.
    const step = report.step === "doi" ? "doi" : lacksByline ? "upload" : "details";
    await touch(ctx, report, { pdf: { ...pdf, pages, text, trouble, ...(lacksByline && { lacksByline }), ...(held && { kept: true }) }, step, title: kept.title.trim() || undefined });
    // The team hears of a reading that failed, of a scan's too: what its author is told first is that it has no text.
    if (unread) await notify(ctx, reportId, "pdf-unread");
    return null;
  },
});

/**
 * The page Openscholar added to a report's PDF, written again with the details its checks read: the new file takes
 * the place of the one before. One made for a PDF replaced meanwhile, or by a run that is no longer the report's, is
 * given up.
 */
export const restamped = internalMutation({
  args: { reportId: v.id("reports"), /** The run of checks whose details the page says: an older run's page never replaces a newer one's. */ runId: v.string(), at: v.number(), file: v.id("_storage"), bytes: v.number() },
  returns: v.null(),
  handler: async (ctx, { reportId, runId, at, file, bytes }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report?.pdf?.stamped || report.pdf.at !== at || report.run?.id !== runId) {
      await ctx.storage.delete(file);
      return null;
    }
    await forget(ctx, report.pdf.file);
    await ctx.db.insert("reportFiles", { file, reportId });
    // Not a change its author made: the report's own moment stays as it was.
    await ctx.db.patch("reports", reportId, { pdf: { ...report.pdf, file, bytes } });
    return null;
  },
});
