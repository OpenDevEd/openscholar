// What ./reading.ts, the action that reads an uploaded PDF, reads before it starts and saves when it's done.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../lib/functions";
import { slugPick } from "../ai/serverModel";
import { effortValidator } from "../aiModelConfig/validators";
import { detailsOf, keptDetails, touch } from "./flow";
import { notify } from "./mail";
import { reportSettings } from "./settings";
import { metadataValidator } from "./validators";
import type { Doc } from "../_generated/dataModel";
import type { Metadata } from "../../lib/reports/report";

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
  args: { reportId: v.id("reports"), at: v.number(), pages: v.optional(v.number()), text: v.optional(v.id("_storage")), metadata: v.optional(metadataValidator), trouble: v.optional(v.union(v.literal("textless"), v.literal("unread"))), /** The details couldn't be read from it, whatever else is wrong with it. */ unread: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { reportId, at, pages, text, metadata, trouble, unread }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report?.pdf || report.pdf.at !== at || report.step === "done") {
      if (text) await ctx.storage.delete(text);
      return null;
    }
    if (!metadata) {
      await touch(ctx, report, { pdf: { ...report.pdf, trouble: "unopened" } });
      await notify(ctx, reportId, "pdf-unopened");
      return null;
    }
    if (text) await ctx.db.insert("reportFiles", { file: text, reportId });
    const profile = (await ctx.db.get("users", report.ownerId))?.profile;
    await ctx.db.patch("reportDetails", (await detailsOf(ctx, reportId))._id, { metadata: keptDetails(signerFilledIn(metadata, report.signedBy.name, profile)) });
    await touch(ctx, report, { pdf: { ...report.pdf, pages, text, trouble }, step: "details", title: metadata.title.trim() || undefined });
    // The team hears of a reading that failed, of a scan's too: what its author is told first is that it has no text.
    if (unread) await notify(ctx, reportId, "pdf-unread");
    return null;
  },
});
