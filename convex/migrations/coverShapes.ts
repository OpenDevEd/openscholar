import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "../lib/functions";
import { isCoverShape } from "../../lib/papers/cover";
import { jpegSize } from "../../lib/papers/jpeg-size";

/**
 * Gives each report's cover drawn before covers kept their shape the width over height of its picture, read from the
 * JPEG's header, so its frame takes that shape too (components/papers/paper-cover.tsx `shape`). Run once per
 * deployment, after the functions that keep it are deployed:
 *   npx convex run migrations/coverShapes:run
 * Safe to run again: a cover with a shape is left alone.
 */
export const run = internalAction({
  args: {},
  returns: v.object({ shaped: v.number(), unread: v.number() }),
  handler: async (ctx): Promise<{ shaped: number; unread: number }> => {
    let shaped = 0;
    let unread = 0;
    let cursor: string | null = null;
    for (;;) {
      const page: { covers: Array<{ reportId: Id<"reports">; file: Id<"_storage"> }>; next: string | null } = await ctx.runQuery(internal.migrations.coverShapes.unshaped, { cursor });
      for (const { reportId, file } of page.covers) {
        const blob = await ctx.storage.get(file);
        const size = blob ? jpegSize(new Uint8Array(await blob.arrayBuffer())) : null;
        const shape = size && size.height > 0 ? size.width / size.height : null;
        if (shape === null || !isCoverShape(shape)) {
          console.log(JSON.stringify({ event: "cover-shape-unread", reportId, file }));
          unread++;
          continue;
        }
        await ctx.runMutation(internal.migrations.coverShapes.keep, { reportId, file, shape });
        shaped++;
      }
      if (page.next === null) break;
      cursor = page.next;
    }
    return { shaped, unread };
  },
});

/** A page of reports, by their covers that have no shape yet. */
export const unshaped = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ covers: v.array(v.object({ reportId: v.id("reports"), file: v.id("_storage") })), next: v.union(v.string(), v.null()) }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("reports").paginate({ cursor, numItems: 100 });
    return {
      covers: page.page.flatMap((report) => (report.cover && report.cover.shape === undefined ? [{ reportId: report._id, file: report.cover.file }] : [])),
      next: page.isDone ? null : page.continueCursor,
    };
  },
});

/** Keeps a cover's shape, when the report still has that cover and no shape for it. */
export const keep = internalMutation({
  args: { reportId: v.id("reports"), file: v.id("_storage"), shape: v.number() },
  returns: v.null(),
  handler: async (ctx, { reportId, file, shape }) => {
    const report = await ctx.db.get("reports", reportId);
    if (report?.cover?.file === file && report.cover.shape === undefined) await ctx.db.patch("reports", reportId, { cover: { ...report.cover, shape } });
    return null;
  },
});
