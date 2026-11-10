// A published report as the rest of Openscholar reads it (plans/publish-reports): its paper page at /papers/R…, and
// the DOI a community is given for a link to that page. Only a live report, or one withdrawn after going live, is
// ever read here: a report that never went live has no page and nothing finds it.
import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import { actorIn } from "../workspaces/actor";
import { detailsOf, mayChange } from "./flow";
import { reportSettings } from "./settings";
import { AUTHORS_LISTED, INSTITUTIONS_LISTED, paperRecordValidator } from "../research/searchValidators";
import { liveReportValidator, withdrawnReportValidator } from "./validators";
import { REPORTS_PER_READ } from "../../lib/reports/report";

const byKey = (ctx: QueryCtx, key: string) => ctx.db.query("reports").withIndex("by_key", (q) => q.eq("key", key)).unique();

/**
 * What a report's address shows, to anyone: a live report's details, its PDF and its cover, or that it was withdrawn,
 * with how it was cited. Null for any other key, a report still on its way included.
 */
export const get = query({
  args: { key: v.string() },
  returns: v.union(v.null(), liveReportValidator, withdrawnReportValidator),
  handler: async (ctx, { key }) => {
    const report = await byKey(ctx, key);
    if (!report || (report.status !== "live" && report.withdrawnAt === undefined)) return null;
    const { metadata } = await detailsOf(ctx, report._id);
    if (!metadata) return null;
    const { series } = await reportSettings(ctx);
    if (report.status !== "live") {
      return { state: "withdrawn" as const, key, doi: report.doi, title: metadata.title, authors: metadata.authors.map((author) => author.name).filter(Boolean), year: Number(metadata.date.slice(0, 4)) || null, series: series.name, withdrawnAt: report.withdrawnAt! };
    }
    return {
      state: "live" as const,
      key,
      doi: report.doi,
      metadata,
      series: { name: series.name, issn: series.issn },
      pdfUrl: report.pdf ? await ctx.storage.getUrl(report.pdf.file) : null,
      coverUrl: report.cover ? await ctx.storage.getUrl(report.cover.file) : null,
      updatedAt: report.updatedAt,
    };
  },
});

/**
 * Whether the person reading a live report's page may correct it (its owner, and its workspace's admins), and whether
 * changes of theirs are already waiting. Null for anyone else, signed out included.
 */
export const mine = query({
  args: { key: v.string() },
  returns: v.union(v.null(), v.object({ waiting: v.boolean(), /** Its workspace's address: an organisation's slug, or null for its owner's own. The page is read from any workspace, and the correction opens in the report's. */ slug: v.union(v.string(), v.null()) })),
  handler: async (ctx, { key }) => {
    const user = await getCurrentUser(ctx);
    const report = user && (await byKey(ctx, key));
    if (!user || !report || report.status !== "live") return null;
    const actor = await actorIn(ctx, user, report.workspaceId);
    if (!actor || !mayChange(actor, report)) return null;
    const workspace = await ctx.db.get("workspaces", report.workspaceId);
    const organization = workspace?.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null;
    return { waiting: report.changes !== undefined, slug: organization?.slug ?? null };
  },
});

/**
 * A live report as the assistant reads a paper (research/papers:get): what its page says of it, by its key. Null for
 * any other key, a report that isn't live included.
 */
export const record = internalQuery({
  args: { key: v.string() },
  returns: v.union(paperRecordValidator, v.null()),
  handler: async (ctx, { key }) => {
    const report = await byKey(ctx, key);
    if (report?.status !== "live") return null;
    const { metadata } = await detailsOf(ctx, report._id);
    if (!metadata) return null;
    const { series } = await reportSettings(ctx);
    const authors = metadata.authors.filter((author) => author.name.trim());
    return {
      id: `https://openscholar.ai/${key}`,
      title: metadata.subtitle.trim() ? `${metadata.title}: ${metadata.subtitle.trim()}` : metadata.title,
      authors: authors.slice(0, AUTHORS_LISTED).map((author) => ({
        name: author.name.slice(0, 120),
        ...(author.affiliations.length && { institutions: author.affiliations.slice(0, INSTITUTIONS_LISTED).map((place) => `${place.name.slice(0, 120)}${place.country ? ` (${place.country})` : ""}`) }),
      })),
      ...(authors.length > AUTHORS_LISTED && { moreAuthors: authors.length - AUTHORS_LISTED }),
      ...(Number(metadata.date.slice(0, 4)) && { year: Number(metadata.date.slice(0, 4)) }),
      published: metadata.date,
      venue: series.name,
      type: metadata.type,
      language: metadata.language,
      doi: report.doi,
      openAccess: true,
      ...(metadata.abstract.trim() && { abstract: metadata.abstract.length > 6_000 ? `${metadata.abstract.slice(0, 6_000)}…` : metadata.abstract }),
    };
  },
});

const communityReportValidator = v.union(
  v.null(),
  // Withdrawn after going live: a community that holds it withdraws it too, and is told nothing more of it.
  v.object({ state: v.literal("withdrawn"), key: v.string(), doi: v.string(), version: v.string() }),
  v.object({
    state: v.literal("live"),
    key: v.string(),
    doi: v.string(),
    /** When anything this answer says of the report last changed, as an ISO time: a community that holds an earlier one takes this one. */
    version: v.string(),
    title: v.string(),
    subtitle: v.string(),
    type: v.string(),
    language: v.string(),
    date: v.string(),
    licence: v.string(),
    abstract: v.string(),
    authors: v.array(v.object({ name: v.string(), orcid: v.union(v.string(), v.null()) })),
    keywords: v.array(v.string()),
    series: v.string(),
    hasPdf: v.boolean(),
  }),
);

/**
 * The reports these DOIs name, for a community that adds papers by DOI (OpenDevEd/new-el#814): each live report's
 * details as its page shows them, a withdrawn one as withdrawn, and null for a DOI that is no report of ours or one
 * that never went live. In the order asked.
 */
export const forCommunity = internalQuery({
  args: { dois: v.array(v.string()) },
  returns: v.array(communityReportValidator),
  handler: async (ctx, { dois }) => {
    const { series, row: settings } = await reportSettings(ctx);
    // The series' name is part of the answer, and it is the settings' to change.
    const version = (at: number) => new Date(Math.max(at, settings?.updatedAt ?? 0)).toISOString();
    return await Promise.all(
      // A report's details can be large, and a query reads at most 16 MiB: the caller asks a few at a time.
      dois.slice(0, REPORTS_PER_READ).map(async (doi) => {
        // A DOI is stored as it was reserved, in lower case.
        const report = await ctx.db.query("reports").withIndex("by_doi", (q) => q.eq("doi", doi.trim().toLowerCase())).unique();
        if (!report) return null;
        if (report.status !== "live") return report.withdrawnAt === undefined ? null : { state: "withdrawn" as const, key: report.key, doi: report.doi, version: version(report.updatedAt) };
        const { metadata } = await detailsOf(ctx, report._id);
        if (!metadata) return null;
        return {
          state: "live" as const,
          key: report.key,
          doi: report.doi,
          // Every change to a report moves its `updatedAt`: an edit made while it was withdrawn, and its reinstatement, too.
          version: version(report.updatedAt),
          title: metadata.title,
          subtitle: metadata.subtitle,
          type: metadata.type,
          language: metadata.language,
          date: metadata.date,
          licence: metadata.licence,
          abstract: metadata.abstract,
          authors: metadata.authors.filter((author) => author.name.trim()).map((author) => ({ name: author.name, orcid: author.orcid || null })),
          keywords: metadata.keywords,
          series: series.name,
          hasPdf: report.pdf !== undefined,
        };
      }),
    );
  },
});

/** A live report's DOI by its key, for a community that was given a link to its page; null for any other key. */
export const doiOf = internalQuery({
  args: { key: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { key }) => {
    const report = await byKey(ctx, key);
    return report?.status === "live" ? report.doi : null;
  },
});
