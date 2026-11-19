import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { httpAction, type ActionCtx, type QueryCtx } from "../_generated/server";
import { internalQuery } from "../lib/functions";
import { requireAppUrl } from "../lib/env";
import { jsonResponse, readBearerCredential } from "../lib/libraryServiceHttp";
import { readConvexErrorData } from "../lib/errors";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { PAGE_ORDERED_SORT, readSearchPage, readWork } from "../paperSets/openalex";
import { spender } from "../paperSets/search";
import { OpenAlexLimitedError } from "../../lib/openalex/limited";
import { normalDoi, openalexWork } from "../../lib/papers/paper-ref";
import { paperLinkOf } from "../../lib/papers/paper-links";
import { ADDED_PAPERS_MAX } from "../../lib/evidence-libraries/added-papers";
import { publicLibraryHeaders } from "../../lib/evidence-libraries/library-shield";
import { REPORTS_ASKED_MAX, REPORTS_PER_READ } from "../../lib/reports/report";

/** A paper as a community takes it: its OpenAlex work, its DOI, or both. */
export type PaperIds = { openalexId: string | null; doi: string | null };

const idsValidator = v.object({ openalexId: v.union(v.string(), v.null()), doi: v.union(v.string(), v.null()) });

/** The community that answers at an address: by where it runs, or by a domain of its own once the proxy serves it there. */
async function libraryAt(ctx: QueryCtx, origin: string) {
  const binding = await ctx.db.query("evidenceLibraryRuntimeBindings").withIndex("by_targetBaseUrl", (q) => q.eq("targetBaseUrl", origin)).first();
  if (binding) return binding.libraryId;
  const domain = await ctx.db.query("evidenceLibraryDomains").withIndex("by_host", (q) => q.eq("host", new URL(origin).hostname)).unique();
  return domain?.attachedAt !== undefined ? domain.libraryId : null;
}

/**
 * What Openscholar knows of a record at an address: whether a community answers there, and the paper its published
 * record is when the community told Openscholar (every community tells it of its published records), so its own site needn't be asked.
 */
export const recordPaper = internalQuery({
  args: { origin: v.string(), itemKey: v.string() },
  returns: v.object({ community: v.boolean(), paper: v.union(idsValidator, v.null()) }),
  handler: async (ctx, { origin, itemKey }) => {
    const libraryId = await libraryAt(ctx, origin);
    const record = libraryId ? await ctx.db.query("topicLocations").withIndex("by_libraryId_and_itemKey", (q) => q.eq("libraryId", libraryId).eq("itemKey", itemKey)).unique() : null;
    return { community: libraryId !== null, paper: record?.state === "published" && (record.openalexId || record.doi) ? { openalexId: record.openalexId, doi: record.doi } : null };
  },
});

/** The paper a community's public record is, as its own site serves it; null for one it doesn't show. Asked only of a known community's address. */
async function recordOnSite(origin: string, itemKey: string): Promise<PaperIds | null> {
  // With the shield's check, as every read of a community's public pages carries it (../../lib/evidence-libraries/library-shield.ts).
  const response = await fetch(`${origin}/api/item/${encodeURIComponent(itemKey)}`, { headers: publicLibraryHeaders("application/json"), signal: AbortSignal.timeout(8_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The community at ${origin} answered ${response.status} for record ${itemKey}`);
  const { item } = (await response.json()) as { item?: { openalexId?: unknown; sourceRecordKey?: unknown; DOI?: unknown } | null };
  const ids = { openalexId: openalexWork(String(item?.openalexId ?? item?.sourceRecordKey ?? "")), doi: normalDoi(typeof item?.DOI === "string" ? item.DOI : null) };
  return ids.openalexId || ids.doi ? ids : null;
}

/**
 * The paper a pasted link names, as a community takes it: an OpenAlex work or DOI as given, a paper only our index has
 * by its OpenAlex work or DOI there, and a community's record by the paper it holds. Null when Openscholar finds none.
 * `spend` counts a read of our index against whoever asked.
 */
export async function paperOfLink(ctx: Pick<ActionCtx, "runQuery">, raw: string, spend: (pages: number) => Promise<boolean>, { withDoi = false } = {}): Promise<PaperIds | null> {
  const link = paperLinkOf(raw);
  if (!link) return null;
  if (link.kind === "doi") return { openalexId: null, doi: link.doi };
  if (link.kind === "report") {
    // A report published on Openscholar is no index's work: a community takes it by the DOI it was registered with.
    const doi = normalDoi(await ctx.runQuery(internal.reports.paper.doiOf, { key: link.key }));
    return doi ? { openalexId: null, doi } : null;
  }
  if (link.kind === "record") {
    const known = await ctx.runQuery(internal.evidenceLibraries.paperLinks.recordPaper, { origin: link.origin, itemKey: link.itemKey });
    return known.paper ?? (known.community ? await recordOnSite(link.origin, link.itemKey) : null);
  }
  // An OpenAlex work is taken as it is, unless its DOI is wanted too, which our index gives as it does an own work's.
  if (link.kind === "work" && !withDoi) return { openalexId: link.openalexId, doi: null };
  const id = link.kind === "work" ? link.openalexId : link.work;
  // A failure to read (an allowance spent, the index down) is the caller's to report: only no such work is null.
  const work = await readWork<{ id?: string; doi?: string | null }>(id, "id,doi", spend, "openscholar");
  const ids = { openalexId: openalexWork(work?.id ?? "") ?? (link.kind === "work" ? link.openalexId : null), doi: normalDoi(work?.doi) };
  return ids.openalexId || ids.doi ? ids : null;
}

const resolveSchema = z
  .object({
    contractVersion: z.literal(1),
    libraryId: z.string().min(1).max(128),
    links: z.array(z.string().min(1).max(2048)).min(1).max(ADDED_PAPERS_MAX),
    /** The signed-in reader the community asks for, whose search allowance our index's reads count against, as their searches do. */
    clerkUserId: z.string().min(1).max(128).optional(),
  })
  .strict();

/**
 * `POST /api/v1/evidence-libraries/papers/resolve`, for a community: the paper each link names (Openscholar's paper
 * pages, a paper only our index has, a community's record, an OpenAlex work), by its OpenAlex work and its DOI where
 * one is known, for a community that imports by DOI; null where none is found. With the community's machine credential.
 */
export const resolvePapers: ReturnType<typeof httpAction> = httpAction(async (ctx, request) => {
  const credential = readBearerCredential(request);
  if (!credential) return jsonResponse(401, { error: { code: "invalid_service_credential", retryable: false } });
  const parsed = resolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonResponse(400, { error: { code: "invalid_request", retryable: false } });
  const { libraryId, links, clerkUserId } = parsed.data;
  if (!(await isCommunity(ctx, libraryId, credential))) return jsonResponse(401, { error: { code: "invalid_service_credential", retryable: false } });
  // A reader's lookups count against their own allowance. The team's, from the admin, aren't counted: at most ADDED_PAPERS_MAX a request, from a signed community.
  const spend = clerkUserId ? spender(ctx, clerkUserId) : async () => true;
  return answerPapers(libraryId, async () => await Promise.all(links.map((link) => paperOfLink(ctx, link, spend, { withDoi: true }))));
});

const reportsSchema = z
  .object({
    contractVersion: z.literal(1),
    libraryId: z.string().min(1).max(128),
    dois: z.array(z.string().min(1).max(512)).min(1).max(REPORTS_ASKED_MAX),
  })
  .strict();

/**
 * `POST /api/v1/evidence-libraries/reports/records`, for a community that adds papers by DOI: the Openscholar Report
 * each DOI names, or null for one that names none (OpenDevEd/new-el#814). A community asks here before OpenAlex and
 * the DOI lookup: a report is in neither until its deposit is indexed, and its record stays Openscholar's. A live
 * report comes with its details, its page and its PDF's lasting address; a withdrawn one says only that it was
 * withdrawn. Asked again on each sync, `version` tells a community when a report was corrected. With the community's
 * machine credential.
 */
export const reportRecords: ReturnType<typeof httpAction> = httpAction(async (ctx, request) => {
  const credential = readBearerCredential(request);
  if (!credential) return jsonResponse(401, { error: { code: "invalid_service_credential", retryable: false } });
  const parsed = reportsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonResponse(400, { error: { code: "invalid_request", retryable: false } });
  const { libraryId, dois } = parsed.data;
  if (!(await isCommunity(ctx, libraryId, credential))) return jsonResponse(401, { error: { code: "invalid_service_credential", retryable: false } });
  try {
    const site = requireAppUrl().replace(/\/+$/, "");
    const asked = dois.map((doi) => normalDoi(doi) ?? doi);
    // A few reports a read, so the largest details still fit one (REPORTS_PER_READ).
    const parts = Array.from({ length: Math.ceil(asked.length / REPORTS_PER_READ) }, (_, at) => asked.slice(at * REPORTS_PER_READ, (at + 1) * REPORTS_PER_READ));
    const reports = (await Promise.all(parts.map((part) => ctx.runQuery(internal.reports.paper.forCommunity, { dois: part, libraryId })))).flat();
    return jsonResponse(200, {
      reports: reports.map((report) => {
        if (report?.state !== "live") return report;
        const { hasPdf, ...details } = report;
        // Both addresses stay the same for as long as the report is live (app/papers/[id]/report.pdf).
        return { ...details, pageUrl: `${site}/papers/${report.key}`, pdfUrl: hasPdf ? `${site}/papers/${report.key}/report.pdf` : null };
      }),
    });
  } catch (error) {
    console.error("[paper links] couldn't read a community's reports", { libraryId, error: String(error) });
    return jsonResponse(503, { error: { code: "temporarily_unavailable", retryable: true } });
  }
});

/** Whether the credential is this community's own. */
export async function isCommunity(ctx: Pick<ActionCtx, "runQuery">, libraryId: string, credential: string) {
  const credentialDigest = await digestOpaqueToken(credential);
  return await ctx.runQuery(internal.topics.serviceHttp.authenticate, { libraryId, credentialDigest }).then(() => true, () => false);
}

/** The papers found, or why they couldn't be read: an allowance spent is said as one, anything else as a failure to try again. */
async function answerPapers(libraryId: string, find: () => Promise<Array<PaperIds | null>>) {
  try {
    return jsonResponse(200, { papers: await find() });
  } catch (error) {
    if (readConvexErrorData(error)?.message === new OpenAlexLimitedError().message) return jsonResponse(429, { error: { code: "rate_limited", retryable: true } });
    console.error("[paper links] couldn't find a community's papers", { libraryId, error: String(error) });
    return jsonResponse(503, { error: { code: "temporarily_unavailable", retryable: true } });
  }
}

/** Papers a title search answers with: a reader picks from a short list. */
const TITLE_MATCHES = 5;

const searchSchema = z
  .object({
    contractVersion: z.literal(1),
    libraryId: z.string().min(1).max(128),
    /** What the reader typed for a title. */
    query: z.string().trim().min(3).max(300),
    /** The signed-in reader who searches, whose allowance the search counts against, as their own searches do. */
    clerkUserId: z.string().min(1).max(128),
  })
  .strict();

/**
 * `POST /api/v1/evidence-libraries/papers/search`, for a community whose reader suggests a paper by its title: the
 * first papers the site's active index finds for the words, each by its OpenAlex work and its DOI where one is known,
 * as `papers/resolve` gives them. With the community's machine credential.
 */
export const searchPapersByTitle: ReturnType<typeof httpAction> = httpAction(async (ctx, request) => {
  const credential = readBearerCredential(request);
  if (!credential) return jsonResponse(401, { error: { code: "invalid_service_credential", retryable: false } });
  const parsed = searchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonResponse(400, { error: { code: "invalid_request", retryable: false } });
  const { libraryId, query, clerkUserId } = parsed.data;
  if (!(await isCommunity(ctx, libraryId, credential))) return jsonResponse(401, { error: { code: "invalid_service_credential", retryable: false } });
  return answerPapers(libraryId, async () => {
    const source = await ctx.runQuery(internal.featureFlags.internal.searchSource, {});
    const { works } = await readSearchPage<{ id?: string; doi?: string | null }>({ search: query, sort: PAGE_ORDERED_SORT, source }, { page: 1, size: TITLE_MATCHES, select: "id,doi" }, spender(ctx, clerkUserId));
    // A paper neither OpenAlex nor a DOI names can't be added to a community, so it isn't offered.
    return works.map((work) => ({ openalexId: openalexWork(work.id ?? ""), doi: normalDoi(work.doi) })).filter((ids) => ids.openalexId || ids.doi);
  });
});
