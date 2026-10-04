import { z } from "zod";
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, type ActionCtx } from "../lib/functions";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { requireAppUrl } from "../lib/env";
import { topicIdSchema, type TopicNode } from "../../lib/topics/contract";
import { CATALOG_REVISION } from "../../lib/topics/catalog";
import type { Doc } from "../_generated/dataModel";
import { openAlexUrl } from "../../lib/openalex/request-url";
import { MAX_TOPIC_KEYWORDS } from "../lib/listCaps";
import { topicKeywordsValidator, topicPathValidator } from "./validators";

const provider = z.object({id: z.string(), description: z.string().max(100000), keywords: z.array(z.string().max(1000)).max(1000), works_count: z.number().int().nonnegative()});
const DAY = 86_400_000;
/** A stale topic is fetched again at most this often, however many people read it. */
const REFRESH_EVERY_MS = 60 * 60 * 1000;
export const read = internalQuery({
  args: {id: v.string()},
  handler: async (ctx, args) => {
    const node = await ctx.db.query("topicCatalog").withIndex("by_external_id", q => q.eq("id", args.id)).unique();
    if (!node || node.level !== "topic") throw createError("NOT_FOUND", "Unknown topic");
    const path = await Promise.all(node.ancestors.map(id => ctx.db.query("topicCatalog").withIndex("by_external_id", q => q.eq("id", id)).unique()));
    return {node, path: path.flatMap(parent => parent ? [{id: parent.id, name: parent.name}] : []), detail: await ctx.db.query("topicDetails").withIndex("by_external_id", q => q.eq("id", args.id)).unique()};
  },
});
export const save = internalMutation({
  args: {id: v.string(), description: v.string(), keywords: v.array(v.string()), worksCount: v.number(), fetchedAt: v.number(), revision: v.string()},
  handler: async (ctx, args) => {
    const current = await ctx.db.query("topicDetails").withIndex("by_external_id", q => q.eq("id", args.id)).unique();
    if (current && current.fetchedAt > args.fetchedAt) return null;
    if (current) await ctx.db.replace("topicDetails", current._id, args);
    else await ctx.db.insert("topicDetails", args);
    return null;
  },
});
/**
 * Schedules one refresh of a stale topic. Anyone may read a topic, so without this every
 * reader of a stale one would ask OpenAlex again on the shared key (#355); now OpenAlex
 * is asked at most once an hour per topic, so a day's topic fetches stay within the
 * catalog's size.
 */
export const requestRefresh = internalMutation({
  args: {id: v.string()},
  returns: v.null(),
  handler: async (ctx, {id}) => {
    const current = await ctx.db.query("topicDetails").withIndex("by_external_id", q => q.eq("id", id)).unique();
    const now = Date.now();
    if (!current || now - current.fetchedAt <= DAY || (current.refreshRequestedAt !== undefined && now - current.refreshRequestedAt < REFRESH_EVERY_MS)) return null;
    await ctx.db.patch("topicDetails", current._id, {refreshRequestedAt: now});
    await ctx.scheduler.runAfter(0, internal.topics.details.refresh, {id});
    return null;
  },
});
async function fetchTopicDetail(id: string) {
  const response = await fetch(openAlexUrl(`topics/${id}`), {signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error(`OpenAlex topic returned ${response.status}`);
  const topic = provider.parse(await response.json());
  if (topic.id.replace("https://openalex.org/", "") !== id) throw new Error("OpenAlex returned a different topic");
  return {id, description: topic.description, keywords: topic.keywords.slice(0, MAX_TOPIC_KEYWORDS), worksCount: topic.works_count, fetchedAt: Date.now(), revision: CATALOG_REVISION};
}
/** Keeps a saved topic's publication count current without making a reader wait. */
export const refresh = internalAction({
  args: {id: v.string()},
  handler: async (ctx, {id}) => {
    try { await ctx.runMutation(internal.topics.details.save, await fetchTopicDetail(id)); }
    catch (error) { console.error("Topic details refresh failed", {topicId: id, revision: CATALOG_REVISION, operation: "refresh", error}); }
  },
});
/**
 * A topic's details are fetched from OpenAlex once and kept. Readers always get
 * the saved copy; one older than a day is refreshed in the background.
 * `libraryId` only labels logs; the service endpoint authenticates the caller first.
 */
export async function readTopicDetail(ctx: ActionCtx, args: {id: string; libraryId?: string}) {
    if (!topicIdSchema.safeParse(args.id).success) throw createError("VALIDATION_ERROR", "Invalid topic ID");
    const result: {node: TopicNode; path: {id: string; name: string}[]; detail: Doc<"topicDetails"> | null} = await ctx.runQuery(internal.topics.details.read, {id: args.id});
    let detail: {description: string; keywords: string[]; worksCount: number; fetchedAt: number; revision: string} | null = result.detail?.revision === CATALOG_REVISION ? result.detail : null;
    if (!detail) {
      try {
        const fetched = await fetchTopicDetail(args.id);
        await ctx.runMutation(internal.topics.details.save, fetched);
        detail = fetched;
      } catch (error) {
        console.error("Topic details unavailable", {topicId: args.id, libraryId: args.libraryId, revision: CATALOG_REVISION, operation: "detail", error});
        throw createError("INVALID_DATA", "Topic description unavailable");
      }
    } else if (Date.now() - detail.fetchedAt > DAY) {
      await ctx.runMutation(internal.topics.details.requestRefresh, {id: args.id});
    }
    return {contractVersion: 1 as const, id: args.id, name: result.node.name, description: detail.description,
      keywords: detail.keywords, path: result.path, worksCount: detail.worksCount, fetchedAt: new Date(detail.fetchedAt).toISOString(), revision: detail.revision,
      publicBaseUrl: requireAppUrl(), topicUrl: new URL(`/topics/${args.id}`, requireAppUrl()).href};
 }
export const get = action({
  args: {id: v.string()},
  returns: v.object({
    contractVersion: v.literal(1), id: v.string(), name: v.string(), description: v.string(), keywords: topicKeywordsValidator,
    path: topicPathValidator, worksCount: v.number(), fetchedAt: v.string(), revision: v.string(),
    publicBaseUrl: v.string(), topicUrl: v.string(),
  }),
  handler: (ctx, args) => readTopicDetail(ctx, args),
});
