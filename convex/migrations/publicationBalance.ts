import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "../lib/functions";
import { customerOf, requestRefresh } from "../billing/accounts";
import { AutumnError, autumn } from "../billing/autumn";
import { PUBLICATION_FEATURE } from "../../lib/billing/plans";
import { DEFAULT_PRICES } from "../../lib/reports/report";
import { choosesLicence } from "../../lib/reports/agreement";

/** The feature a report's activation was counted in, before a workspace paid from a balance in dollars. */
const ACTIVATIONS = "report_activations";
/** What one counted activation is worth in the publication balance: the standard price when they were given. */
const WORTH = DEFAULT_PRICES.standard;

/**
 * Moves what paid for reports before to each workspace's publication balance in Autumn, in US dollars (#1261), and
 * brings the saved words up to licences an author chooses. Run once per deployment, then drop `reportLimits`, the old
 * fields and this file:
 *   npx convex run migrations/publicationBalance:run
 * - A workspace an admin gave free activations a day (`reportLimits`) gets their worth each month, as a plan's
 *   credits refill, and its row goes.
 * - A workspace's balance of counted activations in Autumn becomes dollars, each activation at the standard price:
 *   what refills keeps its interval and what is left of it, what stays keeps what is left, and one with no limit
 *   stays without one. The old balance goes. Every cached account is asked of Autumn, a page at a time, each page
 *   booking the next: an account refreshed since the deploy no longer says it held any.
 * - The saved agreement and byline name the licence chosen (`[licence]`, `{licence}`) where they named CC BY 4.0.
 * - What the old count left behind is cleared: `free`, `unbilled` and `refund` on `reportActivations`, `perDay` and
 *   `orgPerDay` on `reportSettings`, `activations` and `activationsRefill` on `billingAccounts`.
 * Safe to run again: each balance is given under a key of its own, and what was moved is gone. Its log says what moved.
 */
export const run = internalAction({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor }): Promise<null> => {
    /** Whether Autumn gave the balance now: false when an earlier run already had, under the same key. */
    const given = (asked: Promise<unknown>) =>
      asked.then(
        () => true,
        (error: unknown) => {
          if (error instanceof AutumnError && error.code === "duplicate_idempotency_key") return false;
          throw error;
        },
      );
    if (cursor === undefined) {
      for (;;) {
        const rows: Array<{ limitId: Id<"reportLimits">; customerId: string; perDay: number }> = await ctx.runQuery(internal.migrations.publicationBalance.limits, {});
        if (rows.length === 0) break;
        for (const { limitId, customerId, perDay } of rows) {
          if (perDay > 0) {
            await autumn.customer(customerId);
            // Keyed by the row, so a run that stops between giving the balance and dropping the row never gives it twice.
            await given(autumn.createBalance({ customerId, feature: PUBLICATION_FEATURE, amount: perDay * WORTH, interval: "month", idempotencyKey: `publication-limit-${limitId}` }));
            console.log(JSON.stringify({ event: "publication-limit-moved", customerId, dollars: perDay * WORTH }));
          }
          await ctx.runMutation(internal.migrations.publicationBalance.dropLimit, { limitId });
        }
      }
    }
    const page: { accounts: Array<{ workspaceId: Id<"workspaces">; customerId: string; counted: boolean }>; next: string | null } = await ctx.runQuery(internal.migrations.publicationBalance.accounts, { cursor: cursor ?? null });
    for (const { workspaceId, customerId, counted } of page.accounts) {
      const old = (await autumn.customer(customerId)).balances[ACTIVATIONS];
      if (old?.unlimited) await given(autumn.createBalance({ customerId, feature: PUBLICATION_FEATURE, unlimited: true, idempotencyKey: `publication-from-${customerId}-unlimited` }));
      for (const grant of old?.breakdown ?? []) {
        const interval = grant.reset?.interval && grant.reset.interval !== "one_off" ? grant.reset.interval : undefined;
        const size = (grant.included_grant ?? 0) + (grant.prepaid_grant ?? 0);
        // What stays is worth what is left of it; what refills, its size, with what is left set after.
        const amount = (interval ? size : grant.remaining) * WORTH;
        if (amount > 0) {
          const now = await given(autumn.createBalance({ customerId, feature: PUBLICATION_FEATURE, amount, ...(interval && { interval }), idempotencyKey: `publication-from-${grant.id}` }));
          // Only as it is given: set again by a later run, it would undo what was spent in between. A run that stops
          // between the two leaves the refilling part full for its first period, in the workspace's favour.
          if (now && interval && grant.remaining < size) await autumn.setBalance({ customerId, feature: PUBLICATION_FEATURE, interval, left: grant.remaining * WORTH });
          console.log(JSON.stringify({ event: "publication-balance-moved", customerId, interval: interval ?? "once", dollars: grant.remaining * WORTH, of: amount, now }));
        }
        await autumn.deleteBalance({ customerId, feature: ACTIVATIONS, balanceId: grant.id });
      }
      if (counted || old) await ctx.runMutation(internal.migrations.publicationBalance.moved, { workspaceId });
    }
    if (page.next !== null) await ctx.scheduler.runAfter(0, internal.migrations.publicationBalance.run, { cursor: page.next });
    else {
      await ctx.runMutation(internal.migrations.publicationBalance.words, {});
      await ctx.runMutation(internal.migrations.publicationBalance.clear, {});
      console.log(JSON.stringify({ event: "publication-balance-migrated" }));
    }
    return null;
  },
});

export const limits = internalQuery({
  args: {},
  returns: v.array(v.object({ limitId: v.id("reportLimits"), customerId: v.string(), perDay: v.number() })),
  handler: async (ctx) => {
    const rows = await ctx.db.query("reportLimits").take(50);
    return await Promise.all(rows.map(async (row) => ({ limitId: row._id, customerId: await customerOf(ctx, row.workspaceId), perDay: row.perDay })));
  },
});

export const dropLimit = internalMutation({
  args: { limitId: v.id("reportLimits") },
  returns: v.null(),
  handler: async (ctx, { limitId }) => {
    if (await ctx.db.get("reportLimits", limitId)) await ctx.db.delete("reportLimits", limitId);
    return null;
  },
});

/** A page of the cached accounts, each with its customer in Autumn and whether its cache still holds the old count. */
export const accounts = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ accounts: v.array(v.object({ workspaceId: v.id("workspaces"), customerId: v.string(), counted: v.boolean() })), next: v.union(v.string(), v.null()) }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("billingAccounts").paginate({ numItems: 50, cursor });
    return {
      accounts: await Promise.all(page.page.map(async (account) => ({ workspaceId: account.workspaceId, customerId: await customerOf(ctx, account.workspaceId), counted: account.activations !== undefined || account.activationsRefill !== undefined }))),
      next: page.isDone ? null : page.continueCursor,
    };
  },
});

/** An account whose counted activations were moved: the old fields go, and its balance is read again. */
export const moved = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    const account = await ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
    if (account) await ctx.db.patch("billingAccounts", account._id, { activations: undefined, activationsRefill: undefined });
    await requestRefresh(ctx, workspaceId);
    return null;
  },
});

/**
 * The saved byline and agreement, where they still name CC BY 4.0, name the licence the author chooses: the byline
 * gains `{licence}`, and the agreement, as a new version, `[licence]`. Reports signed before keep the agreement they
 * signed. Settings never saved run on the defaults, which have both.
 */
export const words = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await ctx.db.query("reportSettings").first();
    if (!row) return null;
    if (!row.series.byline.includes("{licence}")) await ctx.db.patch("reportSettings", row._id, { series: { ...row.series, byline: `${row.series.byline}, under {licence}` } });
    if (!choosesLicence(row.agreement.text)) {
      const text = row.agreement.text.replace("the Creative Commons Attribution 4.0 licence (CC BY 4.0)", "[licence]").replaceAll("under CC BY 4.0;", "under [licence];");
      if (choosesLicence(text)) {
        const version = row.agreement.version + 1;
        await ctx.db.insert("reportAgreementVersions", { version, text });
        await ctx.db.patch("reportSettings", row._id, { agreement: { version, text, updatedAt: Date.now() } });
      } else console.error(JSON.stringify({ event: "publication-words-unchanged", why: "the saved agreement names its licence in words this doesn't know: add [licence] to it on Admin > Publications" }));
    }
    return null;
  },
});

export const clear = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    if (!cursor) {
      const settings = await ctx.db.query("reportSettings").first();
      if (settings && (settings.perDay !== undefined || settings.orgPerDay !== undefined)) {
        if (settings.perDay || settings.orgPerDay) console.log(JSON.stringify({ event: "activation-defaults-dropped", perDay: settings.perDay, orgPerDay: settings.orgPerDay }));
        await ctx.db.patch("reportSettings", settings._id, { perDay: undefined, orgPerDay: undefined });
      }
    }
    const page = await ctx.db.query("reportActivations").paginate({ numItems: 200, cursor: cursor ?? null });
    for (const row of page.page) {
      if (row.free !== undefined || row.unbilled !== undefined || row.refund !== undefined) await ctx.db.patch("reportActivations", row._id, { free: undefined, unbilled: undefined, refund: undefined });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.publicationBalance.clear, { cursor: page.continueCursor });
    return null;
  },
});
