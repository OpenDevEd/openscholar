import { v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, internalQuery, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { createError, readConvexErrorData } from "./lib/errors";
import { internalMutation, mutation } from "./lib/functions";
import { digestOpaqueToken } from "./lib/opaqueTokenDigest";
import { EXPORT_LINK_MS, exportFilename, exportFiles } from "../lib/export";
import { validateAndExpandKeywordsSilently } from "../lib/keyword-validation";
import { LIBRARY_SEARCH_RESULTS_MAX } from "../lib/library/limits";
import { expandShortcuts, shortcutNames } from "../lib/query-shortcuts";
import { exportFormatValidator, exportSourceValidator } from "./exportValidators";
import { readLibraryPage } from "./library/queries";
import { shortcutExpansions } from "./research/records";
import { screeningExportFiles, screeningItems } from "../lib/screening/export";
import { readScreeningProgressCounts } from "./screening/progress";
import { readScreeningResultsPage } from "./screening/queries";
import { screeningRevision } from "./screening/accounting";
import { paperSetValidator, screeningJobStatusValidator, screeningQuestionsValidator, screeningScoringConfigValidator } from "./screening/validators";
import { searchSnapshotValidator } from "./paperSets/openalex";
import { effortValidator } from "./aiModelConfig/validators";
import { currentSearch } from "../lib/research/records";

/** Rows one export read takes; a library search reads its every match at once. */
const EXPORT_PAGE_SIZE = 100;
/** Leave room for the written and expanded queries, CSV escaping, and one large row after the byte cutoff. */
const HISTORY_PAGE_BYTES = 512 * 1024;
/**
 * Where a part file ends: Convex refuses an HTTP response over 20 MiB, and one more page of
 * rows can follow this mark, so it sits well below.
 */
const PART_BYTES = 15 * 1024 * 1024;
/** How long serving one part may take: an HTTP action runs at most 10 minutes. */
const PART_SERVE_MS = 10 * 60_000;

/** Registers an export of a library view, the search history, the query shortcuts or a screening job's results; `/export` downloads it a part at a time. */
export const start = mutation({
  args: { digest: v.string(), format: exportFormatValidator, source: exportSourceValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!/^[0-9a-f]{64}$/.test(args.digest)) throw createError("VALIDATION_ERROR", "An export needs a SHA-256 digest.");
    const expiresAt = Date.now() + EXPORT_LINK_MS;
    const job = args.source.kind === "screening" ? await ctx.db.get("screeningJobs", args.source.jobId) : null;
    if (args.source.kind === "screening" && (!job || job.userId !== user._id)) throw createError("NOT_FOUND", "Screening job not found");
    const sourceRevision = job ? await screeningRevision(ctx, job) : undefined;
    const id = await ctx.db.insert("exports", { ...args, sourceRevision, userId: user._id, part: 1, cursor: null, serving: false, failed: false, expiresAt });
    await ctx.scheduler.runAfter(EXPORT_LINK_MS, internal.exports.expire, { id });
    return null;
  },
});

/**
 * Where an export the person started stands: the part it's on, whether that part is being
 * served, and whether one failed; null once it's finished or expired.
 */
export const progress = query({
  args: { digest: v.string() },
  returns: v.union(v.object({ part: v.number(), serving: v.boolean(), failed: v.boolean(), failureReason: v.optional(v.literal("changed")) }), v.null()),
  handler: async (ctx, { digest }) => {
    const user = await requireAuth(ctx);
    const row = await ctx.db.query("exports").withIndex("by_digest", (q) => q.eq("digest", digest)).unique();
    return row && row.userId === user._id ? { part: row.part, serving: row.serving, failed: row.failed, failureReason: row.failureReason } : null;
  },
});

/** Ends an export whose link ran out; one still being served or since renewed waits for its own time. */
export const expire = internalMutation({
  args: { id: v.id("exports") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("exports", id);
    if (row && row.expiresAt <= Date.now()) await ctx.db.delete("exports", id);
    return null;
  },
});

/** Takes part `part` of an export to serve: what it writes and where it starts, or null when it isn't ready. */
export const claim = internalMutation({
  args: { digest: v.string(), part: v.number() },
  returns: v.union(
    v.object({ id: v.id("exports"), userId: v.id("users"), format: exportFormatValidator, source: exportSourceValidator, sourceRevision: v.optional(v.string()), cursor: v.union(v.string(), v.null()) }),
    v.null(),
  ),
  handler: async (ctx, { digest, part }) => {
    const row = await ctx.db.query("exports").withIndex("by_digest", (q) => q.eq("digest", digest)).unique();
    if (!row || row.serving || row.failed || row.part !== part || row.expiresAt < Date.now()) return null;
    const expiresAt = Date.now() + PART_SERVE_MS;
    await ctx.db.patch("exports", row._id, { serving: true, expiresAt });
    await ctx.scheduler.runAfter(PART_SERVE_MS, internal.exports.expire, { id: row._id });
    return { id: row._id, userId: row.userId, format: row.format, source: row.source, sourceRevision: row.sourceRevision, cursor: row.cursor };
  },
});

/** Records a served part: the next part's start, or the export's end when `cursor` is null. */
export const finishPart = internalMutation({
  args: { id: v.id("exports"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { id, cursor }) => {
    const row = await ctx.db.get("exports", id);
    if (!row) return null;
    if (row.source.kind === "screening") {
      const job = await ctx.db.get("screeningJobs", row.source.jobId);
      if (!job) throw createError("NOT_FOUND", "Screening job not found");
      await screeningRevision(ctx, job, row.sourceRevision);
    }
    if (cursor === null) {
      await ctx.db.delete("exports", id);
      return null;
    }
    const expiresAt = Date.now() + EXPORT_LINK_MS;
    await ctx.db.patch("exports", id, { part: row.part + 1, cursor, serving: false, expiresAt });
    await ctx.scheduler.runAfter(EXPORT_LINK_MS, internal.exports.expire, { id });
    return null;
  },
});

/** Marks an export failed, so the page that started it can say so; the link then lapses. */
export const failPart = internalMutation({
  args: { id: v.id("exports"), reason: v.optional(v.literal("changed")) },
  returns: v.null(),
  handler: async (ctx, { id, reason }) => {
    if (!(await ctx.db.get("exports", id))) return null;
    await ctx.db.patch("exports", id, { serving: false, failed: true, failureReason: reason, expiresAt: Date.now() + EXPORT_LINK_MS });
    await ctx.scheduler.runAfter(EXPORT_LINK_MS, internal.exports.expire, { id });
    return null;
  },
});

/**
 * One read of an export, written in its format: the rows' text, how many there were, and
 * where the next read starts (null at the end). `written` rows came before in this part.
 */
export const page = internalQuery({
  args: { userId: v.id("users"), source: exportSourceValidator, sourceRevision: v.optional(v.string()), format: exportFormatValidator, cursor: v.union(v.string(), v.null()), written: v.number() },
  returns: v.object({ text: v.string(), count: v.number(), cursor: v.union(v.string(), v.null()) }),
  handler: async (ctx, { userId, source, sourceRevision, format, cursor, written }) => {
    const write = <Item>(read: { page: Item[]; isDone: boolean; continueCursor: string }, item: (item: Item, index: number) => string) => ({
      text: read.page.map((row, i) => item(row, written + i)).join(""),
      count: read.page.length,
      cursor: read.isDone ? null : read.continueCursor,
    });
    if (source.kind === "library") {
      const numItems = source.view.searchText === undefined ? EXPORT_PAGE_SIZE : LIBRARY_SEARCH_RESULTS_MAX;
      return write(await readLibraryPage(ctx, userId, source.view, { cursor, numItems }), exportFiles.library[format].item);
    }
    if (source.kind === "screening") {
      const job = await ctx.db.get("screeningJobs", source.jobId);
      if (!job || job.userId !== userId) throw createError("NOT_FOUND", "Screening job not found");
      await screeningRevision(ctx, job, sourceRevision);
      return write(await readScreeningResultsPage(ctx, job, { cursor, numItems: EXPORT_PAGE_SIZE }), screeningItems(job.questions, { ...job, revision: sourceRevision })[format]);
    }
    if (source.kind === "shortcuts") {
      const read = await ctx.db.query("queryShortcuts").withIndex("by_user", (q) => q.eq("userId", userId)).paginate({ cursor, numItems: EXPORT_PAGE_SIZE, maximumBytesRead: HISTORY_PAGE_BYTES });
      return write({ ...read, page: read.page.map((row) => row.data) }, exportFiles.shortcuts[format].item);
    }
    const read = await ctx.db.query("searches").withIndex("by_user_and_createdAt", (q) => q.eq("userId", userId)).order("desc").paginate({ cursor, numItems: EXPORT_PAGE_SIZE, maximumBytesRead: HISTORY_PAGE_BYTES });
    // Each query with the person's shortcuts expanded, as the history page shows it.
    // ponytail: one lookup per shortcut name the page uses; a page naming more than a
    // function's 4,096 lookups fails the export by name, and would need the names read in chunks.
    const expansions = await shortcutExpansions(ctx, userId, shortcutNames(read.page.map((row) => row.data.query).join("\n")));
    const searches = read.page.map(({ data }) => ({
      ...currentSearch(data),
      resolvedQuery: validateAndExpandKeywordsSilently(data.query, (text) => expandShortcuts(text, expansions)).expandedQuery,
    }));
    return write({ ...read, page: searches }, exportFiles.history[format].item);
  },
});

/** What a screening job's export says about the job, or null when it isn't the person's. */
export const screeningJob = internalQuery({
  args: { userId: v.id("users"), jobId: v.id("screeningJobs") },
  returns: v.union(v.null(), v.object({
    _id: v.id("screeningJobs"),
    revision: v.string(),
    set: v.optional(paperSetValidator),
    snapshot: v.optional(searchSnapshotValidator),
    serverEffort: v.optional(effortValidator),
    first: v.optional(v.number()),
    last: v.optional(v.number()),
    status: screeningJobStatusValidator,
    questions: screeningQuestionsValidator,
    scoringConfig: screeningScoringConfigValidator,
    totalPapers: v.number(),
    qualifiedPapers: v.number(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })),
  handler: async (ctx, { userId, jobId }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (!job || job.userId !== userId) return null;
    const { status, questions, scoringConfig, totalPapers, createdAt, completedAt } = job;
    return { _id: jobId, revision: await screeningRevision(ctx, job), set: job.set, snapshot: job.snapshot, serverEffort: job.serverEffort, first: job.first, last: job.last, status, questions, scoringConfig, totalPapers, qualifiedPapers: (await readScreeningProgressCounts(ctx, job)).qualifiedCount, createdAt, completedAt };
  },
});

/**
 * `GET /export?token=…&part=n`: one part of an export as a complete file. Each page is read
 * only when the download has taken the one before it, and the part ends once it passes
 * PART_BYTES, leaving where the next starts. Pages are separate reads: a row whose sort
 * value changes mid-export can appear twice or not at all.
 */
export const download = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const part = Number(url.searchParams.get("part") ?? "1");
  const claimed = token && Number.isInteger(part) && part > 0
    ? await ctx.runMutation(internal.exports.claim, { digest: await digestOpaqueToken(token), part })
    : null;
  if (!claimed) return new Response("This export link has expired or was used. Start the export again.", { status: 410 });

  const { id, userId, source, format } = claimed;
  const at = new Date();
  const job = source.kind === "screening" ? await ctx.runQuery(internal.exports.screeningJob, { userId, jobId: source.jobId }) : null;
  if (source.kind === "screening" && !job) {
    await ctx.runMutation(internal.exports.failPart, { id });
    return new Response("This screening job wasn't found.", { status: 404 });
  }
  if (job && job.revision !== claimed.sourceRevision) {
    await ctx.runMutation(internal.exports.failPart, { id, reason: "changed" });
    return new Response("Screening changed. Start the export again.", { status: 409 });
  }
  const files = job ? screeningExportFiles(job) : exportFiles[source.kind as Exclude<typeof source.kind, "screening">];
  const file = files[format];
  const encoder = new TextEncoder();
  let cursor = claimed.cursor;
  let started = false;
  let bytes = 0;
  let count = 0;
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, text: string) => {
    const chunk = encoder.encode(text);
    bytes += chunk.byteLength;
    controller.enqueue(chunk);
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          send(controller, file.start(at));
        }
        const read: { text: string; count: number; cursor: string | null } = await ctx.runQuery(internal.exports.page, { userId, source, sourceRevision: claimed.sourceRevision, format, cursor, written: count });
        send(controller, read.text);
        count += read.count;
        cursor = read.cursor;
        if (cursor === null || bytes >= PART_BYTES) {
          await ctx.runMutation(internal.exports.finishPart, { id, cursor });
          send(controller, file.end(count));
          controller.close();
        }
      } catch (error) {
        console.error("[export] Stopped part way", { userId, format, source, part, written: count, bytes, error });
        await ctx.runMutation(internal.exports.failPart, { id, reason: readConvexErrorData(error)?.code === "CONFLICT" ? "changed" : undefined }).catch((cause) => console.error("[export] Couldn't mark the export failed", { id, cause }));
        controller.error(error);
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${exportFilename(files.name(at), format, part)}"`,
      "Cache-Control": "no-store",
    },
  });
});
