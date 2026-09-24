import { v } from "convex/values";
import { action, internalMutation, internalQuery, query, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { topicCatalogRequestSchema, type TopicNode } from "../../lib/topics/contract";
import tree from "../../lib/topics/openalex-topics.json";
import { CATALOG_REVISION } from "../../lib/topics/catalog";
import { authenticate } from "./auth";
import { createError } from "../lib/errors";
import { requireAppUrl } from "../lib/env";

const byId = new Map(tree.map(node => [node.id, node]));
const children = new Map<string | null, number>();
for (const node of tree) children.set(node.parent, (children.get(node.parent) ?? 0) + 1);
function lineage(id: string): {id: string; name: string; parent: string | null}[] {
  const node = byId.get(id);
  if (!node) throw new Error(`Missing OpenAlex catalog parent ${id}`);
  return [...(node.parent ? lineage(node.parent) : []), node];
}
export const seed = internalMutation({
  args: {offset: v.number()},
  handler: async (ctx, {offset}) => {
    if (!Number.isInteger(offset) || offset < 0) throw createError("VALIDATION_ERROR", "Invalid catalog offset");
    for (const node of tree.slice(offset, offset + 100)) {
      const path = lineage(node.id);
      const row = {...node, level: (node.id.startsWith("T") ? "topic" : node.id.split("/")[0].slice(0, -1)) as TopicNode["level"],
        path: path.map(parent => parent.name), ancestors: path.slice(0, -1).map(parent => parent.id), childCount: children.get(node.id) ?? 0,
        domainId: path.find(node => node.id.startsWith("domains/"))?.id ?? "", fieldId: path.find(node => node.id.startsWith("fields/"))?.id ?? "", subfieldId: path.find(node => node.id.startsWith("subfields/"))?.id ?? "",
        revision: CATALOG_REVISION, searchText: path.map(parent => parent.name).join(" ") + " " + node.id};
      const existing = await ctx.db.query("topicCatalog").withIndex("by_external_id", q => q.eq("id", node.id)).unique();
      if (!existing) await ctx.db.insert("topicCatalog", row);
      else if (existing.revision !== CATALOG_REVISION) await ctx.db.replace("topicCatalog", existing._id, row);
    }
    const done = offset + 100 >= tree.length;
    if (done) {
      const state = await ctx.db.query("topicCatalogState").withIndex("by_revision", q => q.eq("revision", CATALOG_REVISION)).unique();
      if (!state) await ctx.db.insert("topicCatalogState", {revision: CATALOG_REVISION, complete: true});
    }
    return done;
  },
});
export const ready = internalQuery({args: {}, handler: async ctx => !!await ctx.db.query("topicCatalogState").withIndex("by_revision", q => q.eq("revision", CATALOG_REVISION)).unique()});
export async function ensureCatalog(ctx: ActionCtx): Promise<null> {
  if (await ctx.runQuery(internal.topics.catalog.ready, {})) return null;
  for (let offset = 0; offset < tree.length; offset += 100) await ctx.runMutation(internal.topics.catalog.seed, {offset});
  return null;
}
export const initialize = action({args: {}, handler: ensureCatalog});
function output(node: TopicNode): TopicNode {
  return {id: node.id, name: node.name, parent: node.parent, level: node.level, path: node.path, childCount: node.childCount};
}
export const serviceBrowse = internalQuery({
  args: {body: v.string(), credentialDigest: v.string()},
  handler: async (ctx, args) => {
    const input = topicCatalogRequestSchema.parse(JSON.parse(args.body));
    await authenticate(ctx, input.libraryId, args.credentialDigest);
    if (input.ids) {
      const nodes = await Promise.all([...new Set(input.ids)].map(id => ctx.db.query("topicCatalog").withIndex("by_external_id", q => q.eq("id", id)).unique()));
      return {contractVersion: 1 as const, nodes: nodes.flatMap(node => node ? [output(node)] : []), revision: CATALOG_REVISION, nextCursor: null, publicBaseUrl: requireAppUrl()};
    }
    const request = input.query?.trim()
      ? ctx.db.query("topicCatalog").withSearchIndex("search_text", q => q.search("searchText", input.query!.trim()))
      : ctx.db.query("topicCatalog").withIndex("by_parent_and_name", q => q.eq("parent", input.parent ?? null));
    const page = await request.paginate({cursor: input.cursor, numItems: input.limit});
    return {contractVersion: 1 as const, nodes: page.page.map(output), revision: CATALOG_REVISION, nextCursor: page.isDone ? null : page.continueCursor, publicBaseUrl: requireAppUrl()};
  },
});
export const resolve = query({
  args: {ids: v.array(v.string())},
  handler: async (ctx, {ids}) => {
    if (ids.length > 100) throw createError("VALIDATION_ERROR", "Too many catalog IDs");
    const nodes = await Promise.all(ids.map(id => ctx.db.query("topicCatalog").withIndex("by_external_id", q => q.eq("id", id)).unique()));
    return nodes.flatMap(node => node ? [output(node)] : []);
  },
});
export const directory = query({
  args: {parent: v.optional(v.union(v.string(), v.null())), query: v.optional(v.string()), ancestor: v.optional(v.string()), cursor: v.union(v.string(), v.null()), limit: v.number()},
  handler: async (ctx, args) => {
    if (args.limit < 1 || args.limit > 100 || !Number.isInteger(args.limit) || (args.query?.length ?? 0) > 200) throw createError("VALIDATION_ERROR", "Invalid topic page");
    const request = args.query?.trim()
      ? ctx.db.query("topicCatalog").withSearchIndex("search_text", q => {
          let search = q.search("searchText", args.query!.trim()).eq("level", "topic");
          if (args.ancestor) search = search.eq(args.ancestor.startsWith("domains/") ? "domainId" : args.ancestor.startsWith("fields/") ? "fieldId" : "subfieldId", args.ancestor);
          return search;
        })
      : args.parent !== undefined
        ? ctx.db.query("topicCatalog").withIndex("by_parent_and_name", q => q.eq("parent", args.parent!))
        : args.ancestor?.startsWith("domains/") ? ctx.db.query("topicCatalog").withIndex("by_level_and_domainId_and_name", q => q.eq("level", "topic").eq("domainId", args.ancestor!))
        : args.ancestor?.startsWith("fields/") ? ctx.db.query("topicCatalog").withIndex("by_level_and_fieldId_and_name", q => q.eq("level", "topic").eq("fieldId", args.ancestor!))
        : args.ancestor ? ctx.db.query("topicCatalog").withIndex("by_level_and_subfieldId_and_name", q => q.eq("level", "topic").eq("subfieldId", args.ancestor!))
        : ctx.db.query("topicCatalog").withIndex("by_level_and_name", q => q.eq("level", "topic"));
    const page = await request.paginate({cursor: args.cursor, numItems: args.limit});
    return {nodes: page.page.map(output), nextCursor: page.isDone ? null : page.continueCursor};
  },
});
