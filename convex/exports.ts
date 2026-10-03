import { v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, internalQuery, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { createError } from "./lib/errors";
import { internalMutation, mutation } from "./lib/functions";
import { digestOpaqueToken } from "./lib/opaqueTokenDigest";
import { EXPORT_LINK_MS, exportFilename, exportFiles } from "../lib/export";
import { validateAndExpandKeywordsSilently } from "../lib/keyword-validation";
import { LIBRARY_SEARCH_RESULTS_MAX } from "../lib/library/limits";
import { expandShortcuts, shortcutNames } from "../lib/query-shortcuts";
import { exportFormatValidator, exportSourceValidator } from "./exportValidators";
import { readLibraryPage } from "./library/queries";
import { shortcutExpansions } from "./research/records";

/** Rows one export read takes; a library search reads its every match at once. */
const EXPORT_PAGE_SIZE = 100;
/**
 * Where a part file ends: Convex refuses an HTTP response over 20 MiB, and one more page of
 * rows can follow this mark, so it sits well below.
 */
const PART_BYTES = 15 * 1024 * 1024;
/** How long serving one part may take: an HTTP action runs at most 10 minutes. */
const PART_SERVE_MS = 10 * 60_000;

/** Registers an export of a library view or the search history; `/export` downloads it a part at a time. */
export const start = mutation({
  args: { digest: v.string(), format: exportFormatValidator, source: exportSourceValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!/^[0-9a-f]{64}$/.test(args.digest)) throw createError("VALIDATION_ERROR", "An export needs a SHA-256 digest.");
    const expiresAt = Date.now() + EXPORT_LINK_MS;
    const id = await ctx.db.insert("exports", { ...args, userId: user._id, part: 1, cursor: null, serving: false, failed: false, expiresAt });
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
  returns: v.union(v.object({ part: v.number(), serving: v.boolean(), failed: v.boolean() }), v.null()),
  handler: async (ctx, { digest }) => {
    const user = await requireAuth(ctx);
    const row = await ctx.db.query("exports").withIndex("by_digest", (q) => q.eq("digest", digest)).unique();
    return row && row.userId === user._id ? { part: row.part, serving: row.serving, failed: row.failed } : null;
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
    v.object({ id: v.id("exports"), userId: v.id("users"), format: exportFormatValidator, source: exportSourceValidator, cursor: v.union(v.string(), v.null()) }),
    v.null(),
  ),
  handler: async (ctx, { digest, part }) => {
    const row = await ctx.db.query("exports").withIndex("by_digest", (q) => q.eq("digest", digest)).unique();
    if (!row || row.serving || row.failed || row.part !== part || row.expiresAt < Date.now()) return null;
    const expiresAt = Date.now() + PART_SERVE_MS;
    await ctx.db.patch("exports", row._id, { serving: true, expiresAt });
    await ctx.scheduler.runAfter(PART_SERVE_MS, internal.exports.expire, { id: row._id });
    return { id: row._id, userId: row.userId, format: row.format, source: row.source, cursor: row.cursor };
  },
});

/** Records a served part: the next part's start, or the export's end when `cursor` is null. */
export const finishPart = internalMutation({
  args: { id: v.id("exports"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { id, cursor }) => {
    const row = await ctx.db.get("exports", id);
    if (!row) return null;
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
  args: { id: v.id("exports") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    if (!(await ctx.db.get("exports", id))) return null;
    await ctx.db.patch("exports", id, { serving: false, failed: true, expiresAt: Date.now() + EXPORT_LINK_MS });
    await ctx.scheduler.runAfter(EXPORT_LINK_MS, internal.exports.expire, { id });
    return null;
  },
});

/**
 * One read of an export, written in its format: the rows' text, how many there were, and
 * where the next read starts (null at the end). `written` rows came before in this part.
 */
export const page = internalQuery({
  args: { userId: v.id("users"), source: exportSourceValidator, format: exportFormatValidator, cursor: v.union(v.string(), v.null()), written: v.number() },
  returns: v.object({ text: v.string(), count: v.number(), cursor: v.union(v.string(), v.null()) }),
  handler: async (ctx, { userId, source, format, cursor, written }) => {
    const write = <Item>(read: { page: Item[]; isDone: boolean; continueCursor: string }, item: (item: Item, index: number) => string) => ({
      text: read.page.map((row, i) => item(row, written + i)).join(""),
      count: read.page.length,
      cursor: read.isDone ? null : read.continueCursor,
    });
    if (source.kind === "library") {
      const numItems = source.view.searchText === undefined ? EXPORT_PAGE_SIZE : LIBRARY_SEARCH_RESULTS_MAX;
      return write(await readLibraryPage(ctx, userId, source.view, { cursor, numItems }), exportFiles.library[format].item);
    }
    const read = await ctx.db.query("searches").withIndex("by_user_and_createdAt", (q) => q.eq("userId", userId)).order("desc").paginate({ cursor, numItems: EXPORT_PAGE_SIZE });
    // Each query with the person's shortcuts expanded, as the history page shows it.
    const expansions = await shortcutExpansions(ctx, userId, shortcutNames(read.page.map((row) => row.data.query).join("\n")));
    const searches = read.page.map(({ data }) => ({
      query: validateAndExpandKeywordsSilently(data.query, (text) => expandShortcuts(text, expansions)).expandedQuery,
      count: data.count,
      field: data.field,
    }));
    return write({ ...read, page: searches }, exportFiles.history[format].item);
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
  const file = exportFiles[source.kind][format];
  const at = new Date();
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
        const read: { text: string; count: number; cursor: string | null } = await ctx.runQuery(internal.exports.page, { userId, source, format, cursor, written: count });
        send(controller, read.text);
        count += read.count;
        cursor = read.cursor;
        if (cursor === null || bytes >= PART_BYTES) {
          send(controller, file.end(count));
          await ctx.runMutation(internal.exports.finishPart, { id, cursor });
          controller.close();
        }
      } catch (error) {
        console.error("[export] Stopped part way", { userId, format, source, part, written: count, bytes, error });
        await ctx.runMutation(internal.exports.failPart, { id }).catch((cause) => console.error("[export] Couldn't mark the export failed", { id, cause }));
        controller.error(error);
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${exportFilename(source.kind, format, at, part)}"`,
      "Cache-Control": "no-store",
    },
  });
});
