/**
 * A big bulk change's papers as the person was asked about them (#637): too many to keep on
 * its step, their changes wait here for the answer, a part at a time, and the reply runs
 * exactly these once the person says yes. Forgotten a day after they were asked.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../lib/functions";

/** What one part's changes weigh at most, as JSON: well inside a document's 1 MiB, and ten of them inside what a transaction reads. */
const PART_BYTES = 512 * 1024;
/** How long the papers wait for the person's answer. */
const KEPT_MS = 24 * 60 * 60_000;
/** Parts one cleanup deletes: ten of PART_BYTES each. */
const FORGET_BATCH = 10;

/** A bulk change's changes in parts no heavier than PART_BYTES, each with the place of its first change. */
export function partsOf(items: Record<string, unknown>[]) {
  const parts: Array<{ first: number; items: string }> = [];
  let [first, bytes, some] = [0, 0, [] as string[]];
  const close = () => {
    if (some.length) parts.push({ first, items: `[${some.join(",")}]` });
    first += some.length;
    [bytes, some] = [0, []];
  };
  for (const item of items) {
    const text = JSON.stringify(item);
    const size = new TextEncoder().encode(text).length;
    if (some.length && bytes + size > PART_BYTES) close();
    some.push(text);
    bytes += size;
  }
  close();
  return parts;
}

/** Keeps one part of a bulk change's changes. The first part schedules their cleanup. */
export const keep = internalMutation({
  args: { userId: v.id("users"), key: v.string(), first: v.number(), items: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("assistantBulkPapers", args);
    if (args.first === 0) await ctx.scheduler.runAfter(KEPT_MS, internal.assistant.bulkPapers.forget, { key: args.key });
    return null;
  },
});

/** The part that holds change `at`, with the place of its first change, or null when there's none: forgotten, or not the person's. */
export const part = internalQuery({
  args: { userId: v.id("users"), key: v.string(), at: v.number() },
  returns: v.union(v.object({ first: v.number(), items: v.string() }), v.null()),
  handler: async (ctx, { userId, key, at }) => {
    const row = await ctx.db.query("assistantBulkPapers").withIndex("by_key_and_first", (q) => q.eq("key", key).lte("first", at)).order("desc").first();
    return row?.userId === userId ? { first: row.first, items: row.items } : null;
  },
});

/** How long a run that started keeps its parts past their day: a run takes minutes at most. */
const RUN_MS = 60 * 60_000;

/** Marks a bulk change's parts as being run, so their cleanup waits for the run. */
export const claim = internalMutation({
  args: { userId: v.id("users"), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, key }) => {
    const first = await ctx.db.query("assistantBulkPapers").withIndex("by_key_and_first", (q) => q.eq("key", key).eq("first", 0)).unique();
    if (first?.userId === userId) await ctx.db.patch("assistantBulkPapers", first._id, { runningSince: Date.now() });
    return null;
  },
});

/** Deletes a bulk change's parts, a batch at a time; while a run of them is going, an hour later. */
export const forget = internalMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    const first = await ctx.db.query("assistantBulkPapers").withIndex("by_key_and_first", (q) => q.eq("key", key).eq("first", 0)).unique();
    if (first?.runningSince !== undefined && Date.now() - first.runningSince < RUN_MS) return void (await ctx.scheduler.runAfter(RUN_MS, internal.assistant.bulkPapers.forget, { key }));
    const parts = await ctx.db.query("assistantBulkPapers").withIndex("by_key_and_first", (q) => q.eq("key", key)).take(FORGET_BATCH);
    for (const part of parts) await ctx.db.delete("assistantBulkPapers", part._id);
    if (parts.length === FORGET_BATCH) await ctx.scheduler.runAfter(0, internal.assistant.bulkPapers.forget, { key });
    return null;
  },
});
