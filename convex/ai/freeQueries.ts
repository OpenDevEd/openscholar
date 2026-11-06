import { v } from "convex/values";
import { query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internalMutation, mutation } from "../lib/functions";
import { requireAdmin } from "../admins/access";
import { createError } from "../lib/errors";
import { rateLimit } from "../lib/rateLimit";
import { requireAvailableModel, requireEffort, requireTaskModel } from "../models/catalog";
import { effortValidator, modelSummaryValidator } from "../aiModelConfig/validators";
import { FLAG_REGISTRY } from "../../lib/feature-flags/registry";
import { FREE_QUERY_DEFAULTS, FREE_QUESTIONS_FLAG } from "../../lib/ai/free-queries";
import type { Effort } from "../../lib/ai/core/call-options";
import { modelSummary, slugPick } from "./serverModel";
import { refuseApps } from "../lib/auth";

const DAY_MS = 24 * 60 * 60 * 1000;
const TASK = "questionToQuery";
const PERSON = "free-query-person";
const ADDRESS = "free-query-address";
const SIGNED_IN = "free-query-signed-in";
const SIGNED_OUT = "free-query-signed-out";
const ALL = "all";

/** A fixed UTC day, so a daily limit really is one: a bucket that refills as it goes spends half as much again in a day. */
const perUtcDay = (perDay: number) => ({ kind: "fixed window" as const, rate: perDay, period: DAY_MS, start: 0 });

/** The one settings row, over the defaults. */
async function settingsOf(ctx: QueryCtx) {
  const row = await ctx.db.query("freeQuerySettings").first();
  return { row, ...FREE_QUERY_DEFAULTS, effort: FREE_QUERY_DEFAULTS.effort as Effort | undefined, ...row };
}

async function switchedOn(ctx: QueryCtx) {
  const flag = await ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", FREE_QUESTIONS_FLAG)).unique();
  return flag?.enabled ?? FLAG_REGISTRY[FREE_QUESTIONS_FLAG].enabled;
}

const whoValidator = v.union(v.object({ person: v.string() }), v.object({ address: v.string() }));

/**
 * Whether this call may run, counting it if so, and on what. The caller's own limit is spent first,
 * so someone already over theirs can't use up the day's total.
 */
export const claim = internalMutation({
  args: { who: whoValidator },
  returns: v.union(
    v.object({ kind: v.literal("go"), modelId: v.id("models"), effort: v.optional(effortValidator) }),
    v.object({ kind: v.union(v.literal("off"), v.literal("limit"), v.literal("unavailable")) }),
  ),
  handler: async (ctx, { who }) => {
    if (!(await switchedOn(ctx))) return { kind: "off" as const };
    const settings = await settingsOf(ctx);
    const pick = await slugPick(ctx, settings.modelId, settings.effort, TASK);
    if (!pick) {
      console.error(JSON.stringify({ event: "free-query-model-unavailable", model: settings.modelId }));
      return { kind: "unavailable" as const };
    }
    const spend = (name: string, key: string, perDay: number) =>
      rateLimit(ctx, { name, key, config: perUtcDay(perDay) });
    const own = "person" in who
      ? await spend(PERSON, who.person, settings.perPerson)
      : await spend(ADDRESS, who.address, settings.perAddress);
    if (!own.ok) return { kind: "limit" as const };
    const total = "person" in who
      ? await spend(SIGNED_IN, ALL, settings.signedInPerDay)
      : await spend(SIGNED_OUT, ALL, settings.signedOutPerDay);
    if (!total.ok) {
      console.warn(JSON.stringify({ event: "free-query-daily-total-reached", audience: "person" in who ? "signedIn" : "signedOut" }));
      return { kind: "limit" as const };
    }
    return { kind: "go" as const, ...pick };
  },
});

const audienceValidator = v.union(v.literal("signedIn"), v.literal("signedOut"));

/** Adds a finished call to its day, for the admin page. */
export const record = internalMutation({
  args: { audience: audienceValidator, day: v.string(), costUsd: v.number(), failed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { audience, day, costUsd, failed }) => {
    const row = await ctx.db.query("freeQueryDays").withIndex("by_day_and_audience", (q) => q.eq("day", day).eq("audience", audience)).unique();
    const counted = { calls: (row?.calls ?? 0) + 1, failed: (row?.failed ?? 0) + (failed ? 1 : 0), costUsd: (row?.costUsd ?? 0) + costUsd };
    if (row) await ctx.db.patch("freeQueryDays", row._id, counted);
    else await ctx.db.insert("freeQueryDays", { day, audience, ...counted });
    return null;
  },
});

const dayValidator = v.object({ calls: v.number(), failed: v.number(), costUsd: v.number() });
const limitFields = { perAddress: v.number(), perPerson: v.number(), signedOutPerDay: v.number(), signedInPerDay: v.number() };

/** What the admin page shows: the model, the limits and `day`'s calls, the day being the page's so this query doesn't read the clock. */
export const settings = query({
  args: { day: v.string() },
  returns: v.object({
    ...limitFields,
    model: v.union(modelSummaryValidator, v.null()),
    effort: v.optional(effortValidator),
    signedIn: dayValidator,
    signedOut: dayValidator,
  }),
  handler: async (ctx, { day }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const { modelId, effort, perAddress, perPerson, signedOutPerDay, signedInPerDay } = await settingsOf(ctx);
    const pick = await slugPick(ctx, modelId, effort, TASK);
    const of = async (audience: "signedIn" | "signedOut") => {
      const row = await ctx.db.query("freeQueryDays").withIndex("by_day_and_audience", (q) => q.eq("day", day).eq("audience", audience)).unique();
      return { calls: row?.calls ?? 0, failed: row?.failed ?? 0, costUsd: row?.costUsd ?? 0 };
    };
    return {
      perAddress, perPerson, signedOutPerDay, signedInPerDay,
      model: await modelSummary(ctx, pick?.modelId ?? null),
      ...(pick?.effort && { effort: pick.effort }),
      signedIn: await of("signedIn"),
      signedOut: await of("signedOut"),
    };
  },
});

async function saveSettings(ctx: MutationCtx, fields: Partial<{ modelId: string; effort: Effort | undefined; perAddress: number; perPerson: number; signedOutPerDay: number; signedInPerDay: number }>) {
  const { row, modelId, effort, perAddress, perPerson, signedOutPerDay, signedInPerDay } = await settingsOf(ctx);
  const next = { modelId, effort, perAddress, perPerson, signedOutPerDay, signedInPerDay, ...fields, updatedAt: Date.now() };
  if (row) await ctx.db.replace("freeQuerySettings", row._id, next);
  else await ctx.db.insert("freeQuerySettings", next);
}

export const setPick = mutation({
  args: { modelId: v.id("models"), effort: v.optional(effortValidator) },
  returns: v.null(),
  handler: async (ctx, { modelId, effort }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const model = await requireAvailableModel(ctx, modelId);
    requireEffort(model, effort);
    requireTaskModel(model, TASK);
    await saveSettings(ctx, { modelId: model.modelId, effort });
    return null;
  },
});

export const setLimits = mutation({
  args: limitFields,
  returns: v.null(),
  handler: async (ctx, limits) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    // The switch is how it stops, not a limit of zero.
    if (Object.values(limits).some((limit) => !Number.isInteger(limit) || limit < 1 || limit > 10_000_000)) throw createError("VALIDATION_ERROR", "Limits are whole numbers from 1 to 10,000,000");
    const before = await settingsOf(ctx);
    await saveSettings(ctx, limits);
    // A day's total changes today, by what it changed: raised to get through a busy day, it would otherwise wait for tomorrow.
    await moveTotal(ctx, SIGNED_IN, limits.signedInPerDay - before.signedInPerDay);
    await moveTotal(ctx, SIGNED_OUT, limits.signedOutPerDay - before.signedOutPerDay);
    return null;
  },
});

async function moveTotal(ctx: MutationCtx, name: string, by: number) {
  const row = await ctx.db.query("rateLimits").withIndex("name", (q) => q.eq("name", name).eq("key", ALL)).unique();
  if (row && by !== 0) await ctx.db.patch("rateLimits", row._id, { value: row.value + by });
}
