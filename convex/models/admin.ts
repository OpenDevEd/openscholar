import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { requireAdmin } from "../admins/access";
import { activeModels, MAX_CATALOG_MODELS } from "./catalog";

/** Providers with their own filter chip; the rest are "other". */
const TOP_PROVIDERS = 4;

/**
 * One page of the model list for admins, with the provider chips. The catalog
 * is bounded (MAX_CATALOG_MODELS), so it's filtered and counted in memory.
 */
export const list = query({
  args: {
    provider: v.optional(v.string()),
    search: v.string(),
    show: v.union(v.literal("all"), v.literal("on"), v.literal("off")),
    page: v.number(),
    pageSize: v.number(),
  },
  returns: v.object({
    total: v.number(),
    providers: v.array(v.object({ provider: v.string(), sampleModelId: v.string() })),
    rows: v.array(
      v.object({
        _id: v.id("models"),
        modelId: v.string(),
        name: v.string(),
        contextLength: v.optional(v.number()),
        inputPricePerMillion: v.number(),
        outputPricePerMillion: v.number(),
        intelligenceIndex: v.optional(v.number()),
        on: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const all = await activeModels(ctx).take(MAX_CATALOG_MODELS);
    const counts = new Map<string, { n: number; sample: string }>();
    for (const m of all) {
      const c = counts.get(m.provider);
      counts.set(m.provider, { n: (c?.n ?? 0) + 1, sample: c?.sample ?? m.modelId });
    }
    const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, TOP_PROVIDERS);
    const topNames = new Set(top.map(([p]) => p));
    const search = args.search.trim().toLowerCase();
    const matches = all.filter(
      (m) =>
        (!args.provider || (args.provider === "other" ? !topNames.has(m.provider) : m.provider === args.provider)) &&
        (!search || `${m.name} ${m.modelId}`.toLowerCase().includes(search)) &&
        (args.show === "all" || (args.show === "on") === !m.hidden),
    );
    const size = Math.min(Math.max(1, Math.floor(args.pageSize)), 100);
    // A page past the end (after the last row on it was switched off) shows the last page.
    const lastPage = Math.max(1, Math.ceil(matches.length / size));
    const start = (Math.min(Math.max(1, Math.floor(args.page)), lastPage) - 1) * size;
    return {
      total: matches.length,
      providers: top.map(([provider, c]) => ({ provider, sampleModelId: c.sample })),
      rows: matches.slice(start, start + size).map((m) => ({
        _id: m._id,
        modelId: m.modelId,
        name: m.name,
        ...(m.contextLength !== undefined ? { contextLength: m.contextLength } : {}),
        inputPricePerMillion: m.inputPricePerMillion,
        outputPricePerMillion: m.outputPricePerMillion,
        intelligenceIndex: m.intelligenceIndex,
        on: !m.hidden,
      })),
    };
  },
});

/** Keeps a model out of users' pickers, or offers it again. */
export const setOffered = mutation({
  args: { modelId: v.id("models"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { modelId, on }) => {
    await requireAdmin(ctx);
    if (await ctx.db.get("models", modelId)) await ctx.db.patch("models", modelId, { hidden: !on, updatedAt: Date.now() });
    return null;
  },
});
