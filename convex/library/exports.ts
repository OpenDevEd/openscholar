import { v } from "convex/values";
import { internal } from "../_generated/api";
import { httpAction, internalQuery, query } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { internalMutation, mutation } from "../lib/functions";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { LIBRARY_EXPORT_LINK_MS, libraryExportFile, libraryExportFilename } from "../../lib/library/export";
import { LIBRARY_SEARCH_RESULTS_MAX } from "../../lib/library/limits";
import { libraryPageValidator, readLibraryPage, type LibraryPage } from "./queries";
import { libraryExportFormatValidator, libraryViewValidator } from "./validators";

/** Papers one export read takes; a search reads its every match at once. */
const EXPORT_PAGE_SIZE = 100;
/**
 * Where a part file ends: Convex refuses an HTTP response over 20 MiB, and one more page of
 * papers can follow this mark, so it sits well below.
 */
const PART_BYTES = 15 * 1024 * 1024;
/** How long serving one part may take: an HTTP action runs at most 10 minutes. */
const PART_SERVE_MS = 10 * 60_000;

/** Registers an export of a library view; `/library/export` downloads it a part at a time. */
export const start = mutation({
  args: { digest: v.string(), format: libraryExportFormatValidator, view: libraryViewValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!/^[0-9a-f]{64}$/.test(args.digest)) throw createError("VALIDATION_ERROR", "An export needs a SHA-256 digest.");
    const expiresAt = Date.now() + LIBRARY_EXPORT_LINK_MS;
    const id = await ctx.db.insert("libraryExports", { ...args, userId: user._id, part: 1, cursor: null, serving: false, expiresAt });
    await ctx.scheduler.runAfter(LIBRARY_EXPORT_LINK_MS, internal.library.exports.expire, { id });
    return null;
  },
});

/** The part an export the person started has ready, or null once it's finished or expired. */
export const progress = query({
  args: { digest: v.string() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { digest }) => {
    const user = await requireAuth(ctx);
    const row = await ctx.db.query("libraryExports").withIndex("by_digest", (q) => q.eq("digest", digest)).unique();
    return row && row.userId === user._id ? row.part : null;
  },
});

/** Ends an export whose link ran out; one still being served or since renewed waits for its own time. */
export const expire = internalMutation({
  args: { id: v.id("libraryExports") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("libraryExports", id);
    if (row && row.expiresAt <= Date.now()) await ctx.db.delete("libraryExports", id);
    return null;
  },
});

/** Takes part `part` of an export to serve: its view and where it starts, or null when it isn't ready. */
export const claim = internalMutation({
  args: { digest: v.string(), part: v.number() },
  returns: v.union(
    v.object({ id: v.id("libraryExports"), userId: v.id("users"), format: libraryExportFormatValidator, view: libraryViewValidator, cursor: v.union(v.string(), v.null()) }),
    v.null(),
  ),
  handler: async (ctx, { digest, part }) => {
    const row = await ctx.db.query("libraryExports").withIndex("by_digest", (q) => q.eq("digest", digest)).unique();
    if (!row || row.serving || row.part !== part || row.expiresAt < Date.now()) return null;
    const expiresAt = Date.now() + PART_SERVE_MS;
    await ctx.db.patch("libraryExports", row._id, { serving: true, expiresAt });
    await ctx.scheduler.runAfter(PART_SERVE_MS, internal.library.exports.expire, { id: row._id });
    return { id: row._id, userId: row.userId, format: row.format, view: row.view, cursor: row.cursor };
  },
});

/** Records a served part: the next part's start, or the export's end when `cursor` is null. */
export const finishPart = internalMutation({
  args: { id: v.id("libraryExports"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { id, cursor }) => {
    const row = await ctx.db.get("libraryExports", id);
    if (!row) return null;
    if (cursor === null) {
      await ctx.db.delete("libraryExports", id);
      return null;
    }
    const expiresAt = Date.now() + LIBRARY_EXPORT_LINK_MS;
    await ctx.db.patch("libraryExports", id, { part: row.part + 1, cursor, serving: false, expiresAt });
    await ctx.scheduler.runAfter(LIBRARY_EXPORT_LINK_MS, internal.library.exports.expire, { id });
    return null;
  },
});

export const page = internalQuery({
  args: { userId: v.id("users"), view: libraryViewValidator, cursor: v.union(v.string(), v.null()) },
  returns: libraryPageValidator,
  handler: async (ctx, { userId, view, cursor }) =>
    await readLibraryPage(ctx, userId, view, { cursor, numItems: view.searchText === undefined ? EXPORT_PAGE_SIZE : LIBRARY_SEARCH_RESULTS_MAX }),
});

/**
 * `GET /library/export?token=…&part=n`: one part of an export as a complete file. Each page
 * is read only when the download has taken the one before it, and the part ends once it
 * passes PART_BYTES, leaving where the next starts. Pages are separate reads: a paper whose
 * sort value changes mid-export can appear twice or not at all.
 */
export const download = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const part = Number(url.searchParams.get("part") ?? "1");
  const claimed = token && Number.isInteger(part) && part > 0
    ? await ctx.runMutation(internal.library.exports.claim, { digest: await digestOpaqueToken(token), part })
    : null;
  if (!claimed) return new Response("This export link has expired or was used. Start the export again from your library.", { status: 410 });

  const { id, userId, view, format } = claimed;
  const file = libraryExportFile[format];
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
        const read: LibraryPage = await ctx.runQuery(internal.library.exports.page, { userId, view, cursor });
        send(controller, read.page.map((item) => file.item(item, count++)).join(""));
        cursor = read.isDone ? null : read.continueCursor;
        if (cursor === null || bytes >= PART_BYTES) {
          send(controller, file.end(count));
          await ctx.runMutation(internal.library.exports.finishPart, { id, cursor });
          controller.close();
        }
      } catch (error) {
        console.error("[library export] Stopped part way", { userId, format, view, part, written: count, bytes, error });
        controller.error(error);
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${libraryExportFilename(format, at, part)}"`,
      "Cache-Control": "no-store",
    },
  });
});
