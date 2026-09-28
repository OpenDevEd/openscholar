/**
 * A copy of Autumn's catalog (plans and features), so pages and plan checks
 * read it reactively. A cron re-reads Autumn every few minutes; Autumn has no
 * event for catalog edits.
 */
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { autumn, type AutumnFeature, type AutumnPlan } from "./autumn";
import { billingCatalogValidator, type BillingCatalog, type CatalogPlan } from "./validators";
import { CREDITS_FEATURE } from "../../lib/billing/plans";

function metadataList(value: unknown): string[] | undefined {
  const list = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value.split(/\n|,/)
      : [];
  const trimmed = list.map((item) => item.trim()).filter(Boolean);
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Reduces an Autumn plan to what OpenScholar reads. */
export function catalogPlan(plan: AutumnPlan, booleanFeatures: Set<string>): CatalogPlan {
  const creditsItem = plan.items.find((item) => item.feature_id === CREDITS_FEATURE);
  const metadata = plan.metadata ?? {};
  const bundles = metadataList(metadata.bundles)
    ?.map(Number)
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  return {
    id: plan.id,
    name: plan.name,
    ...(plan.description ? { description: plan.description } : {}),
    ...(plan.group ? { group: plan.group } : {}),
    addOn: plan.add_on,
    autoEnable: plan.auto_enable,
    ...(plan.price ? { price: { amount: plan.price.amount, interval: plan.price.interval } } : {}),
    ...(creditsItem
      ? {
          credits: {
            included: creditsItem.included,
            interval: creditsItem.reset?.interval ?? creditsItem.price?.interval ?? "one_off",
            ...(creditsItem.rollover?.max != null ? { rolloverMax: creditsItem.rollover.max } : {}),
            ...(creditsItem.price
              ? {
                  unitPrice: {
                    amount: creditsItem.price.amount,
                    billingUnits: creditsItem.price.billing_units,
                  },
                }
              : {}),
          },
        }
      : {}),
    features: plan.items
      .map((item) => item.feature_id)
      .filter((featureId) => booleanFeatures.has(featureId)),
    popular: metadata.popular === true || metadata.popular === "true",
    ...(metadataList(metadata.highlights) ? { highlights: metadataList(metadata.highlights) } : {}),
    ...(bundles && bundles.length > 0 ? { bundles } : {}),
  };
}

/** The live, unarchived catalog in OpenScholar's shape. */
export function catalogFrom(plans: AutumnPlan[], features: AutumnFeature[]): BillingCatalog {
  const live = features.filter((feature) => !feature.archived);
  const booleanFeatures = new Set(live.filter((f) => f.type === "boolean").map((f) => f.id));
  return {
    plans: plans.filter((plan) => !plan.archived).map((plan) => catalogPlan(plan, booleanFeatures)),
    features: live.map(({ id, name, type }) => ({ id, name, type })),
  };
}

export async function readCatalog(ctx: QueryCtx | MutationCtx): Promise<BillingCatalog | null> {
  const row = await ctx.db.query("billingCatalog").first();
  return row ? { plans: row.plans, features: row.features } : null;
}

export const write = internalMutation({
  args: { catalog: billingCatalogValidator },
  returns: v.null(),
  handler: async (ctx, { catalog }) => {
    const existing = await ctx.db.query("billingCatalog").first();
    const row = { ...catalog, syncedAt: Date.now() };
    if (existing) await ctx.db.replace("billingCatalog", existing._id, row);
    else await ctx.db.insert("billingCatalog", row);
    return null;
  },
});

export const sync = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const [plans, features] = await Promise.all([autumn.listPlans(), autumn.listFeatures()]);
    await ctx.runMutation(internal.billing.catalog.write, {
      catalog: catalogFrom(plans.list, features.list),
    });
    return null;
  },
});

/** The catalog for pages; null until the first sync. */
export const get = query({
  args: {},
  returns: v.union(billingCatalogValidator, v.null()),
  handler: readCatalog,
});
