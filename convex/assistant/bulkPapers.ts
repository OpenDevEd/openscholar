/**
 * A big bulk change's papers as the person was asked about them (#637): too many to keep on
 * its step, their changes wait here for the answer, a part at a time, and the reply runs
 * exactly these once the person says yes. Forgotten a day after they were asked.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../lib/functions";

/** Changes one part holds: each a paper's record, well inside a document. */
export const PART_ITEMS = 200;
/** Parts one read returns: inside what a query reads. */
const PARTS_A_READ = 10;
/** How long the papers wait for the person's answer. */
const KEPT_MS = 24 * 60 * 60_000;
/** Parts one cleanup deletes. */
const FORGET_BATCH = 50;

/** Keeps one part of a bulk change's changes. The first part schedules their cleanup. */
export const keep = internalMutation({
  args: { userId: v.id("users"), key: v.string(), part: v.number(), items: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("assistantBulkPapers", args);
    if (args.part === 0) await ctx.scheduler.runAfter(KEPT_MS, internal.assistant.bulkPapers.forget, { key: args.key });
    return null;
  },
});

/** A page of a bulk change's parts, in order: each a JSON array of changes. Only the person's own. */
export const read = internalQuery({
  args: { userId: v.id("users"), key: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ parts: v.array(v.string()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { userId, key, cursor }) => {
    const page = await ctx.db.query("assistantBulkPapers").withIndex("by_key_and_part", (q) => q.eq("key", key)).paginate({ cursor, numItems: PARTS_A_READ });
    return { parts: page.page.filter((part) => part.userId === userId).map((part) => part.items), isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Deletes a bulk change's parts, a batch at a time. */
export const forget = internalMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    const parts = await ctx.db.query("assistantBulkPapers").withIndex("by_key_and_part", (q) => q.eq("key", key)).take(FORGET_BATCH);
    for (const part of parts) await ctx.db.delete("assistantBulkPapers", part._id);
    if (parts.length === FORGET_BATCH) await ctx.scheduler.runAfter(0, internal.assistant.bulkPapers.forget, { key });
    return null;
  },
});
