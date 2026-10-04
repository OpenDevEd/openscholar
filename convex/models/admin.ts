import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, type QueryCtx } from "../lib/functions";
import schema from "../schema";
import { requireAdmin, requireAdminUser } from "../admins/access";
import { topProvidersValidator } from "../aiModelConfig/validators";
import { MAX_TOP_PROVIDERS } from "../lib/listCaps";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { activeModels, MAX_CATALOG_MODELS } from "./catalog";

const adminModelValidator = v.object({
  _id: v.id("models"),
  modelId: v.string(),
  name: v.string(),
  contextLength: v.optional(v.number()),
  inputPricePerMillion: v.number(),
  outputPricePerMillion: v.number(),
  intelligenceIndex: v.optional(v.number()),
  on: v.boolean(),
});

/** A view of the admin model list: one provider's models or the "other" providers', a search, and offered or not. */
const viewArgs = { provider: v.optional(v.string()), search: v.string(), show: v.union(v.literal("all"), v.literal("on"), v.literal("off")) };
type View = { provider?: string; search: string; show: "all" | "on" | "off" };

/** The providers with the most models, most first. The catalog holds at most MAX_CATALOG_MODELS (./mutations.ts refuses more). */
function topProviders(all: Doc<"models">[]) {
  const counts = new Map<string, { n: number; sample: string }>();
  for (const m of all) {
    const c = counts.get(m.provider);
    counts.set(m.provider, { n: (c?.n ?? 0) + 1, sample: c?.sample ?? m.modelId });
  }
  return [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, MAX_TOP_PROVIDERS).map(([provider, c]) => ({ provider, sampleModelId: c.sample }));
}

/** Whether a model is in a view; `top` names the providers that "other" leaves out. */
function inView(view: View, top: Set<string>) {
  const search = view.search.trim().toLowerCase();
  return (m: Doc<"models">) =>
    (!view.provider || (view.provider === "other" ? !top.has(m.provider) : m.provider === view.provider)) &&
    (!search || `${m.name} ${m.modelId}`.toLowerCase().includes(search)) &&
    (view.show === "all" || (view.show === "on") === !m.hidden);
}

const row = (m: Doc<"models">) => ({
  _id: m._id,
  modelId: m.modelId,
  name: m.name,
  ...(m.contextLength !== undefined ? { contextLength: m.contextLength } : {}),
  inputPricePerMillion: m.inputPricePerMillion,
  outputPricePerMillion: m.outputPricePerMillion,
  intelligenceIndex: m.intelligenceIndex,
  on: !m.hidden,
});

const names = (providers: Array<{ provider: string }>) => new Set(providers.map((p) => p.provider));

export const listModelsAction = defineUserQuery({
  path: "models/admin:listModels",
  description:
    "Lists the model catalog for admins, a page at a time, in the order the catalog holds it: each model with its prices, context, intelligence and whether users are offered it. " +
    "Given `provider`, only that provider's models, or with \"other\" those of the providers without a filter of their own; given `search`, only models whose name or ID contains it; `show` keeps all, the offered ones, or the hidden ones.",
  args: { paginationOpts: paginationOptsValidator, ...viewArgs },
  returns: paginationResultValidator(adminModelValidator),
  run: async (ctx, userId, { paginationOpts, ...view }) => {
    await requireAdminUser(ctx, userId);
    // "Other" is every provider but the largest, which only the whole catalog names.
    const top = view.provider === "other" ? names(topProviders(await activeModels(ctx).take(MAX_CATALOG_MODELS))) : new Set<string>();
    const models = stream(ctx.db, schema).query("models");
    const rows =
      view.provider && view.provider !== "other"
        ? models.withIndex("by_provider_and_retiredAt", (q) => q.eq("provider", view.provider!).eq("retiredAt", undefined))
        : models.withIndex("by_retiredAt", (q) => q.eq("retiredAt", undefined));
    const keeps = inView(view, top);
    return await rows
      .filterWith(async (m) => keeps(m))
      .map(async (m) => row(m))
      // One more than the catalog holds, so a view with no match is read to its end in one go.
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 100), maximumRowsRead: MAX_CATALOG_MODELS + 1 });
  },
});
export const listModels = userQuery(listModelsAction);
export const listModelsForAssistant = assistantQuery(listModelsAction);

/** The models a view holds and the provider chips, from one read of the catalog, which a sync caps at MAX_CATALOG_MODELS. */
async function summaryOf(ctx: QueryCtx, userId: Id<"users">, view: View) {
  await requireAdminUser(ctx, userId);
  const all = await activeModels(ctx).take(MAX_CATALOG_MODELS);
  const providers = topProviders(all);
  return { total: all.filter(inView(view, names(providers))).length, providers };
}

export const summaryAction = defineUserQuery({
  path: "models/admin:summary",
  description: "Says how many models a view of the admin model list holds (see listModels for the view), and names the providers with the most models, each with one of its model IDs.",
  args: viewArgs,
  returns: v.object({ total: v.number(), providers: topProvidersValidator }),
  run: summaryOf,
});
export const summary = userQuery(summaryAction);
export const summaryForAssistant = assistantQuery(summaryAction);

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
