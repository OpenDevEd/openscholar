import { z } from "zod";
import { v } from "convex/values";
import { action, internalMutation, internalQuery, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { requireAppUrl } from "../lib/env";
import { topicIdSchema, type TopicNode } from "../../lib/topics/contract";
import { CATALOG_REVISION } from "../../lib/topics/catalog";
import type { Doc } from "../_generated/dataModel";

const provider = z.object({id: z.string(), description: z.string().max(100000), keywords: z.array(z.string().max(1000)).max(1000), works_count: z.number().int().nonnegative()});
const DAY = 86_400_000;
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
/** `libraryId` only labels logs; the service endpoint authenticates the caller first. */
export async function readTopicDetail(ctx: ActionCtx, args: {id: string; libraryId?: string}) {
    if (!topicIdSchema.safeParse(args.id).success) throw createError("VALIDATION_ERROR", "Invalid topic ID");
    const result: {node: TopicNode; path: {id: string; name: string}[]; detail: Doc<"topicDetails"> | null} = await ctx.runQuery(internal.topics.details.read, {id: args.id});
    let detail: {description: string; keywords: string[]; worksCount: number; fetchedAt: number; revision: string} | null = result.detail;
    if (!detail || detail.revision !== CATALOG_REVISION || Date.now() - detail.fetchedAt > DAY) {
      try {
        const url = new URL(`https://api.openalex.org/topics/${args.id}`);
        if (process.env.OPENALEX_API_KEY) url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
        const response = await fetch(url, {signal: AbortSignal.timeout(10000)});
        if (!response.ok) throw new Error(`OpenAlex topic returned ${response.status}`);
        const topic = provider.parse(await response.json());
        if (topic.id.replace("https://openalex.org/", "") !== args.id) throw new Error("OpenAlex returned a different topic");
        const fresh = {id: args.id, description: topic.description, keywords: topic.keywords, worksCount: topic.works_count, fetchedAt: Date.now(), revision: CATALOG_REVISION};
        await ctx.runMutation(internal.topics.details.save, fresh);
        detail = fresh;
      } catch (error) {
        console.error("Topic details unavailable", {topicId: args.id, libraryId: args.libraryId, revision: CATALOG_REVISION, operation: "detail", error});
        if (!detail || Date.now() - detail.fetchedAt > 7 * DAY) throw createError("INVALID_DATA", "Topic description unavailable");
      }
    }
    return {contractVersion: 1 as const, id: args.id, name: result.node.name, description: detail.description,
      keywords: detail.keywords, path: result.path, worksCount: detail.worksCount, fetchedAt: new Date(detail.fetchedAt).toISOString(), revision: detail.revision,
      publicBaseUrl: requireAppUrl(), topicUrl: new URL(`/topics/${args.id}`, requireAppUrl()).href};
 }
export const get = action({
  args: {id: v.string()},
  handler: (ctx, args) => readTopicDetail(ctx, args),
});
