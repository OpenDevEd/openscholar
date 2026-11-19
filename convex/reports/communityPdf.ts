// A community's copy of a report whose licence doesn't let anyone share it (#1467): Openscholar's readers may read its
// PDF, but a community gets it only once someone who may change the report agrees, told the licence, when they add
// the report there. Anyone else adds the report without its PDF (paper.ts `forCommunity`).
import { v } from "convex/values";
import { query, type QueryCtx } from "../_generated/server";
import { mutation } from "../lib/functions";
import { createError } from "../lib/errors";
import { getCurrentUser, refuseApps } from "../lib/auth";
import { actorIn } from "../workspaces/actor";
import { mayChange } from "./flow";
import { PDF_COMMUNITIES_MAX, communityPdfQuestionValidator } from "./validators";
import { fileAccessOf, licenceName, licenceOf, licenceUrl } from "../../lib/reports/report";

/** The live report a DOI names that the person may change, while only Openscholar's readers may have its PDF: null otherwise. */
async function asked(ctx: QueryCtx, doi: string) {
  const user = await getCurrentUser(ctx);
  // A DOI is stored as it was reserved, in lower case.
  const report = user && (await ctx.db.query("reports").withIndex("by_doi", (q) => q.eq("doi", doi.trim().toLowerCase())).unique());
  if (!user || !report || report.status !== "live" || fileAccessOf(licenceOf(report), report.fileAccess).mode !== "readers") return null;
  const actor = await actorIn(ctx, user, report.workspaceId);
  return actor && mayChange(actor, report) ? report : null;
}

/**
 * What to ask the person adding a paper to a community: its licence, when it is a report of theirs whose PDF only
 * Openscholar's readers may have, and whether each community was already given it. Null when nothing is asked.
 */
export const question = query({
  args: { doi: v.string() },
  returns: communityPdfQuestionValidator,
  handler: async (ctx, { doi }) => {
    await refuseApps(ctx);
    const report = await asked(ctx, doi);
    if (!report) return null;
    const licence = licenceOf(report);
    return { key: report.key, licence: licenceName(licence), licenceUrl: licenceUrl(licence), agreed: report.pdfCommunities ?? [] };
  },
});

/** The person's answer for one community: `give` lets it have the PDF; no takes back a yes given before. */
export const answer = mutation({
  args: { doi: v.string(), libraryId: v.id("evidenceLibraries"), give: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { doi, libraryId, give }) => {
    await refuseApps(ctx);
    const report = await asked(ctx, doi);
    if (!report) throw createError("FORBIDDEN", "Only someone who can change this report decides whether a community gets its PDF.");
    const others = (report.pdfCommunities ?? []).filter((id) => id !== libraryId);
    if (give && others.length >= PDF_COMMUNITIES_MAX) throw createError("VALIDATION_ERROR", `A report's PDF goes to at most ${PDF_COMMUNITIES_MAX} communities. Write to us to raise it.`);
    await ctx.db.patch("reports", report._id, { pdfCommunities: give ? [...others, libraryId] : others, updatedAt: Math.max(Date.now(), report.updatedAt + 1) });
    return null;
  },
});
