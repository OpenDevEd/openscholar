// The feed Openscholar's search engine reads published reports from (OpenDevEd/openalex-count#1437): once a minute it
// asks for the reports changed since it last read, and now and then for all of them, and writes them into the search
// index, where the search API serves each as a work with its R… id. A report that goes live is added, a correction
// replaces it, and a withdrawn one leaves. The engine sends exactly the two bodies below; its owner's hand-off is
// openscholar-api docs/handoffs/report-indexing-open-scholar-20261115.md.
import { v, type Infer } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { httpAction, type QueryCtx } from "../_generated/server";
import { internalQuery } from "../lib/functions";
import { requireAppUrl } from "../lib/env";
import { jsonResponse, readBearerCredential } from "../lib/libraryServiceHttp";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { detailsOf } from "./flow";
import { reportSettings } from "./settings";
import { canonicalJson, indexRecord } from "../../lib/reports/index-record";
import { REPORTS_PER_READ } from "../../lib/reports/report";
import { seriesOf } from "../../lib/reports/settings";
import { normalDoi } from "../../lib/papers/paper-ref";

/** The most reports a page reads. The engine asks for 200. */
const PAGE_MAX = 200;

const positionValidator = v.object({ updatedAt: v.number(), key: v.string() });
const pageValidator = v.object({
  /** The reports read that are live or were withdrawn: a draft, or one declined before it went live, is never in the index. */
  reports: v.array(v.id("reports")),
  /** Where the next page starts: the last report read, whether or not it was kept. */
  after: v.union(positionValidator, v.null()),
  cursor: v.union(v.string(), v.null()),
  done: v.boolean(),
  /** When the series' settings last changed: a new ISSN changes every record, though no report's own `updatedAt` moves. */
  seriesChangedAt: v.number(),
});

const indexed = (report: Doc<"reports">) => report.status === "live" || report.withdrawnAt !== undefined;
// ponytail: any settings change counts as the series', which only costs the engine an extra check; give the series its own time if that matters.
const seriesChangedAt = async (ctx: QueryCtx) => Math.floor((await reportSettings(ctx)).row?.updatedAt ?? 0);

/** The reports that changed after a position, in the order they changed. */
export const changes = internalQuery({
  args: { after: v.union(positionValidator, v.null()), limit: v.number() },
  returns: pageValidator,
  handler: async (ctx, { after, limit: asked }) => {
    const limit = Math.min(asked, PAGE_MAX);
    // One more than the page, to tell whether more follow: a page of drafts alone is short, with more behind it.
    const sameTime = after ? await ctx.db.query("reports").withIndex("by_updatedAt_and_key", (q) => q.eq("updatedAt", after.updatedAt).gt("key", after.key)).take(limit + 1) : [];
    const later = await ctx.db
      .query("reports")
      .withIndex("by_updatedAt_and_key", (q) => (after ? q.gt("updatedAt", after.updatedAt) : q))
      .take(Math.min(limit + 1 - sameTime.length, PAGE_MAX + 1));
    const read = [...sameTime, ...later];
    const page = read.slice(0, limit);
    const last = page.at(-1);
    return {
      reports: page.filter(indexed).map((report) => report._id),
      after: last ? { updatedAt: last.updatedAt, key: last.key } : after,
      cursor: null,
      done: read.length <= limit,
      seriesChangedAt: await seriesChangedAt(ctx),
    };
  },
});

/** Every report, a page at a time, for the engine to check the index holds each as it stands. */
export const all = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), limit: v.number() },
  returns: pageValidator,
  handler: async (ctx, { cursor, limit }) => {
    const page = await ctx.db.query("reports").withIndex("by_updatedAt_and_key").paginate({ cursor, numItems: Math.min(limit, PAGE_MAX) });
    return { reports: page.page.filter(indexed).map((report) => report._id), after: null, cursor: page.continueCursor, done: page.isDone, seriesChangedAt: await seriesChangedAt(ctx) };
  },
});

const recordValidator = v.object({
  title: v.string(),
  abstract: v.string(),
  date: v.string(),
  type: v.string(),
  language: v.string(),
  authors: v.array(v.object({ name: v.string(), orcid: v.union(v.string(), v.null()), affiliations: v.array(v.object({ id: v.union(v.string(), v.null()), name: v.string(), country: v.union(v.string(), v.null()) })) })),
  topics: v.array(v.string()),
  sdgs: v.array(v.string()),
  funders: v.array(v.string()),
  licence: v.union(v.string(), v.null()),
  series: v.object({ name: v.string(), issn: v.union(v.string(), v.null()) }),
  pageUrl: v.string(),
  pdfUrl: v.union(v.string(), v.null()),
});
const itemValidator = v.object({
  key: v.string(),
  updatedAt: v.number(),
  state: v.union(v.literal("live"), v.literal("withdrawn")),
  doi: v.string(),
  zenodoDoi: v.union(v.string(), v.null()),
  record: v.union(recordValidator, v.null()),
});

/** These reports as the index takes them: a live one with its record, a withdrawn one with none. A few a read, as each holds its details. */
export const items = internalQuery({
  args: { reports: v.array(v.id("reports")), site: v.string() },
  returns: v.array(itemValidator),
  handler: async (ctx, { reports, site }) => {
    const { series } = await reportSettings(ctx);
    const read = await Promise.all(
      reports.slice(0, REPORTS_PER_READ).map(async (id): Promise<Infer<typeof itemValidator> | null> => {
        const report = await ctx.db.get("reports", id);
        if (!report || !indexed(report)) return null;
        const live = report.status === "live";
        const metadata = live ? (await detailsOf(ctx, report._id)).metadata : undefined;
        if (live && !metadata) return null;
        return {
          key: report.key,
          updatedAt: report.updatedAt,
          state: live ? "live" : "withdrawn",
          doi: normalDoi(report.doi) ?? report.doi,
          zenodoDoi: normalDoi(report.zenodoDoi),
          record: live ? indexRecord({ key: report.key, hasPdf: report.pdf !== undefined }, metadata!, seriesOf(report, series), site) : null,
        };
      }),
    );
    return read.filter((item) => item !== null);
  },
});

const limit = z.number().int().min(1).max(PAGE_MAX);
const requestSchema = z.union([
  z.object({ after: z.object({ updatedAt: z.number().int().min(0), key: z.string().min(1).max(32) }).strict().nullable(), limit }).strict(),
  z.object({ all: z.literal(true), cursor: z.string().min(1).max(4096).nullable(), limit }).strict(),
]);

/** Whether the request carries the engine's credential: its digest is the one set on this deployment. */
async function isEngine(request: Request) {
  const credential = readBearerCredential(request);
  const expected = process.env.SEARCH_INDEX_FEED_CREDENTIAL_DIGEST;
  if (!expected) console.error("[search index feed] SEARCH_INDEX_FEED_CREDENTIAL_DIGEST is not set: every request is refused");
  return credential !== null && !!expected && (await digestOpaqueToken(credential)) === expected;
}

/**
 * `POST /api/v1/search-index/reports`, for the search engine, with its own credential: a page of reports, either the
 * ones changed after a position (`after`) or all of them (`all`), each with the SHA-256 of its record, so the engine
 * writes only what changed.
 */
export const reports: ReturnType<typeof httpAction> = httpAction(async (ctx, request) => {
  if (!(await isEngine(request))) return jsonResponse(401, { error: { code: "invalid_service_credential", retryable: false } });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonResponse(400, { error: { code: "invalid_request", retryable: false } });
  const asked = parsed.data;
  try {
    // Typed here: these queries are this module's own, so inference would loop.
    const page: Infer<typeof pageValidator> = "all" in asked ? await ctx.runQuery(internal.reports.searchIndex.all, { cursor: asked.cursor, limit: asked.limit }) : await ctx.runQuery(internal.reports.searchIndex.changes, { after: asked.after, limit: asked.limit });
    const site = requireAppUrl().replace(/\/+$/, "");
    const parts = Array.from({ length: Math.ceil(page.reports.length / REPORTS_PER_READ) }, (_, at) => page.reports.slice(at * REPORTS_PER_READ, (at + 1) * REPORTS_PER_READ));
    const read = (await Promise.all(parts.map((part): Promise<Array<Infer<typeof itemValidator>>> => ctx.runQuery(internal.reports.searchIndex.items, { reports: part, site })))).flat();
    const items = await Promise.all(read.map(async (item) => ({ ...item, digest: await digestOpaqueToken(canonicalJson(item.record)) })));
    const position = "all" in asked ? { cursor: page.done ? null : page.cursor } : { after: page.after };
    return jsonResponse(200, { version: 1, items, ...position, done: page.done, seriesChangedAt: page.seriesChangedAt });
  } catch (error) {
    console.error("[search index feed] couldn't read the reports", { asked: JSON.stringify(asked), error: String(error) });
    return jsonResponse(503, { error: { code: "temporarily_unavailable", retryable: true } });
  }
});
