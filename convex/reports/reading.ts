"use node";

// Reads a report's PDF once it's uploaded (./flow.ts `attachPdf`): its pages and text, which the checks read, and
// its details, which the model set on the admin page reads for the author to correct.
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { resolveOpenRouterModel } from "../ai/provider";
import { extractPdfJsTextPages } from "../extraction/pdfjs_extract";
import { buildPageTextFromItems } from "../../lib/extraction/pdfjs-text";
import { blankDetails, DETAILS_MAX_BYTES, DETAIL_CAPS, DETAIL_TEXT, type Metadata } from "../../lib/reports/report";
import { readDetails } from "./reader";

/** What the model read, held to what a report keeps: a PDF with more references than that keeps the first of them,
 * a title, keyword or grant number longer than a report holds is cut to fit, and a date still to come is today,
 * each for its author to put right. Nothing a PDF says keeps its details from being saved (`keptDetails`). */
function capped(metadata: Metadata): Metadata {
  const cut = <T,>(list: T[], cap: number) => list.slice(0, cap);
  const word = (text: string) => text.slice(0, DETAIL_TEXT.keyword);
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...metadata,
    title: metadata.title.slice(0, DETAIL_TEXT.title),
    subtitle: metadata.subtitle.slice(0, DETAIL_TEXT.subtitle),
    abstract: metadata.abstract.slice(0, DETAIL_TEXT.abstract),
    date: metadata.date > today ? today : metadata.date,
    authors: cut(metadata.authors, DETAIL_CAPS.authors).map((author) => ({ ...author, affiliations: cut(author.affiliations, DETAIL_CAPS.affiliations), roles: cut(author.roles, DETAIL_CAPS.roles) })),
    topics: cut(metadata.topics, DETAIL_CAPS.topics),
    keywords: cut(metadata.keywords, DETAIL_CAPS.keywords).map(word),
    studyDesigns: cut(metadata.studyDesigns, DETAIL_CAPS.studyDesigns),
    countries: cut(metadata.countries, DETAIL_CAPS.countries),
    funding: cut(metadata.funding, DETAIL_CAPS.funding).map((funding) => ({ ...funding, awards: cut(funding.awards, DETAIL_CAPS.awards).map(word) })),
    references: cut(metadata.references, DETAIL_CAPS.references),
    relations: cut(metadata.relations, DETAIL_CAPS.relations),
  };
}

export const read = internalAction({
  args: { reportId: v.id("reports"), at: v.number() },
  returns: v.null(),
  handler: async (ctx, { reportId, at }) => {
    const job = await ctx.runQuery(internal.reports.readingState.begin, { reportId, at });
    if (!job) return null;
    const blob = await ctx.storage.get(job.file);
    if (!blob) return null;
    const bytes = await blob.arrayBuffer();
    // pdf.js takes its buffer over, so it reads a copy and the model gets the original.
    const opened = await extractPdfJsTextPages(bytes.slice(0)).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "report-pdf-unopened", reportId, name: job.name, bytes: bytes.byteLength, error: String(error).slice(0, 300) }));
      return null;
    });
    if (!opened) {
      await ctx.runMutation(internal.reports.readingState.finish, { reportId, at });
      return null;
    }
    // Built from its pieces as the extraction does, so a line break in the PDF is a break, not two words run together.
    const text = opened.pages.map((page) => buildPageTextFromItems(page.items).text).join("\n");
    const textFile = await ctx.storage.store(new Blob([text], { type: "text/plain" }));
    let metadata: Metadata | null = null;
    try {
      if (!job.modelId) throw new Error("The model that reads PDFs is no longer offered.");
      const { model, modelSlug } = await resolveOpenRouterModel(ctx, job.modelId);
      const read = capped(await readDetails({ pdf: new Uint8Array(bytes), text, fileName: job.name, ownDoi: job.doi, reader: { model, slug: modelSlug, effort: job.effort } }));
      // A reading that found neither a title nor an abstract read nothing: the author fills the details in, as for one that failed.
      if (!read.title.trim() && !read.abstract.trim()) throw new Error("The reading found no title and no abstract.");
      // Each list within its cap can still add up to more than a report holds: such a reading is filled in by hand too.
      if (JSON.stringify(read).length > DETAILS_MAX_BYTES) throw new Error("The reading is longer than a report holds.");
      metadata = read;
    } catch (error) {
      console.error(JSON.stringify({ event: "report-details-unread", reportId, error: String(error).slice(0, 600) }));
    }
    const details = metadata ?? blankDetails(job.name, new Date().toISOString().slice(0, 10));
    // A PDF that names no author is its signer's until they say otherwise.
    if (!details.authors.length) details.authors = [{ name: job.signer, orcid: "", openalexId: null, affiliations: [], corresponding: true, roles: [] }];
    // A scan holds no text for the checks to read, which matters more to its author than a reading that fell short.
    const trouble = !text.trim() ? ("textless" as const) : metadata ? undefined : ("unread" as const);
    await ctx.runMutation(internal.reports.readingState.finish, { reportId, at, pages: opened.totalPages, text: textFile, metadata: details, ...(trouble && { trouble }), ...(!metadata && { unread: true }) });
    return null;
  },
});
