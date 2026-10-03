import { v } from "convex/values";
import { internal } from "../_generated/api";
import { httpAction, internalQuery } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { internalMutation, mutation } from "../lib/functions";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { LIBRARY_EXPORT_LINK_MS, libraryExportFile, libraryExportFilename } from "../../lib/library/export";
import { LIBRARY_SEARCH_RESULTS_MAX } from "../../lib/library/limits";
import { libraryPageValidator, readLibraryPage, type LibraryPage } from "./queries";
import { libraryExportFormatValidator, libraryViewValidator } from "./validators";

/** Papers one export read takes: a browse page at most; a search reads its every match at once. */
const EXPORT_PAGE_SIZE = 500;

/** Registers a one-time export of a library view; `/library/export` downloads it. */
export const start = mutation({
  args: { digest: v.string(), format: libraryExportFormatValidator, view: libraryViewValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!/^[0-9a-f]{64}$/.test(args.digest)) throw createError("VALIDATION_ERROR", "An export needs a SHA-256 digest.");
    const id = await ctx.db.insert("libraryExports", { ...args, userId: user._id, expiresAt: Date.now() + LIBRARY_EXPORT_LINK_MS });
    await ctx.scheduler.runAfter(LIBRARY_EXPORT_LINK_MS, internal.library.exports.expire, { id });
    return null;
  },
});

export const expire = internalMutation({
  args: { id: v.id("libraryExports") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    if (await ctx.db.get("libraryExports", id)) await ctx.db.delete("libraryExports", id);
    return null;
  },
});

/** Uses up an export link: its view and owner, or null when it's unknown, used or expired. */
export const claim = internalMutation({
  args: { digest: v.string() },
  returns: v.union(v.object({ userId: v.id("users"), format: libraryExportFormatValidator, view: libraryViewValidator }), v.null()),
  handler: async (ctx, { digest }) => {
    const row = await ctx.db.query("libraryExports").withIndex("by_digest", (q) => q.eq("digest", digest)).unique();
    if (!row) return null;
    await ctx.db.delete("libraryExports", row._id);
    return row.expiresAt < Date.now() ? null : { userId: row.userId, format: row.format, view: row.view };
  },
});

export const page = internalQuery({
  args: { userId: v.id("users"), view: libraryViewValidator, cursor: v.union(v.string(), v.null()) },
  returns: libraryPageValidator,
  handler: async (ctx, { userId, view, cursor }) =>
    await readLibraryPage(ctx, userId, view, { cursor, numItems: view.searchText === undefined ? EXPORT_PAGE_SIZE : LIBRARY_SEARCH_RESULTS_MAX }),
});

/**
 * `GET /library/export?token=…`: the export as a file, written a page at a time as each
 * is read, so it's never held whole. Pages are separate reads: a paper whose sort value
 * changes mid-export can appear twice or not at all.
 */
export const download = httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("token");
  const claimed = token ? await ctx.runMutation(internal.library.exports.claim, { digest: await digestOpaqueToken(token) }) : null;
  if (!claimed) return new Response("This export link has expired. Start the export again from your library.", { status: 410 });
  const { userId, view, format } = claimed;
  const file = libraryExportFile[format];
  const at = new Date();
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let count = 0;
      try {
        controller.enqueue(encoder.encode(file.start(at)));
        for (let cursor: string | null = null; ;) {
          const read: LibraryPage = await ctx.runQuery(internal.library.exports.page, { userId, view, cursor });
          controller.enqueue(encoder.encode(read.page.map((item) => file.item(item, count++)).join("")));
          if (read.isDone) break;
          cursor = read.continueCursor;
        }
        controller.enqueue(encoder.encode(file.end(count)));
        controller.close();
      } catch (error) {
        console.error("[library export] Stopped part way", { userId, format, view, written: count, error });
        controller.error(error);
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${libraryExportFilename(format, at)}"`,
      "Cache-Control": "no-store",
    },
  });
});
