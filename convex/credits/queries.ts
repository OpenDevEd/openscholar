import { query } from "../_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator, type Cursor } from "convex/server";
import { filter } from "convex-helpers/server/filter";
import { mergedStream, stream } from "convex-helpers/server/stream";
import schema from "../schema";
import { getCurrentUser } from "../lib/auth";
import {
  billingTypeValidator,
  creditBalanceValidator,
  creditTransactionValidator,
} from "../lib/validators";
import { components } from "../_generated/api";
import { getCreditTopupCatalog, getCreditsPerUsd } from "../lib/creditTopups";
import { getFlag } from "../featureFlags/guard";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readTransactionFacetCounts } from "./aggregates";
import { readBalance } from "./balanceCounter";


export const TRACKED_GRANT_EVENT_TYPES = [
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.reconcile",
  "invoice.reconcile.pull",
] as const;

export function selectLatestTrackedGrantEvent<T extends { eventType: string; updatedAt: number }>(
  events: T[],
) {
  return events
    .filter((row) =>
      TRACKED_GRANT_EVENT_TYPES.includes(
        row.eventType as (typeof TRACKED_GRANT_EVENT_TYPES)[number],
      ),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export const getMyBalance = query({
  args: {},
  returns: v.union(creditBalanceValidator, v.null()),
  handler: async (ctx) => {

    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (!credits) {
      return { free: 0, paid: 0, total: 0 };
    }

    return await readBalance(ctx, credits._id);
  },
});

export const getTransactions = query({
  args: {
    limit: v.optional(v.number()),
    /**
     * Plan-04: when provided, returns only usage rows whose first-class
     * jobId column matches. Uses the by_job index so the filter is
     * O(rows for this job) rather than scanning the user's full ledger.
     * Ownership is enforced by refusing to surface rows that don't
     * belong to the caller's credits record.
     */
    jobId: v.optional(v.id("extractionJobs")),
  },
  returns: v.array(creditTransactionValidator),
  handler: async (ctx, args) => {

    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (!credits) return [];

    if (args.jobId) {
      const rows = await ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
        .order("desc")
        .take(args.limit ?? 200);
      return rows.filter((row) => row.creditsId === credits._id);
    }

    const transactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_credits", (q) => q.eq("creditsId", credits._id))
      .order("desc")
      .take(args.limit ?? 50);

    return transactions;
  },
});

export const checkBalance = query({
  args: {
    requiredAmount: v.number(),
  },
  returns: v.union(
    v.object({
      hasEnough: v.boolean(),
      free: v.number(),
      paid: v.number(),
      total: v.number(),
      required: v.number(),
      deficit: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {

    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    const { free, paid, total } = credits
      ? await readBalance(ctx, credits._id)
      : { free: 0, paid: 0, total: 0 };

    return {
      hasEnough: total >= args.requiredAmount,
      free,
      paid,
      total,
      required: args.requiredAmount,
      deficit: Math.max(0, args.requiredAmount - total),
    };
  },
});

export const getTopupCatalog = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    creditsPerUsd: v.number(),
    bundles: v.array(
      v.object({
        key: v.string(),
        credits: v.number(),
        amountCents: v.number(),
        currency: v.literal("usd"),
      }),
    ),
  }),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const topupsFlag = await getFlag(ctx, "credits.topups");
    const topupsEnabled = topupsFlag?.enabled ?? false;
    const creditsPerUsd = getCreditsPerUsd();

    if (!user || !topupsEnabled) {
      return {
        enabled: false,
        creditsPerUsd,
        bundles: [],
      };
    }

    return {
      enabled: true,
      creditsPerUsd,
      bundles: getCreditTopupCatalog(creditsPerUsd),
    };
  },
});

export const getLatestGrantStatus = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      lastGrantAt: v.optional(v.number()),
      lastGrantInvoiceId: v.optional(v.string()),
      latestEventStatus: v.optional(v.string()),
      latestEventClassification: v.optional(v.string()),
      latestEventError: v.optional(v.string()),
      latestEventUpdatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {

    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    const grantTransactions = credits
      ? await ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", credits._id))
          .order("desc")
          .take(100)
      : [];

    const lastGrant = grantTransactions.find((tx) => tx.type === "grant");

    const invoiceIds = new Set<string>();
    const subscriptionIds = new Set<string>();

    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(10);

    for (const subscription of subscriptions) {
      if (subscription.stripeSubscriptionId) {
        subscriptionIds.add(subscription.stripeSubscriptionId);
      }
    }

    // Cardinality: ~1-3 billing customers per user
    const billingCustomers = await ctx.db
      .query("billingCustomers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const stripeCustomerIds = new Set<string>();
    for (const billingCustomer of billingCustomers) {
      stripeCustomerIds.add(billingCustomer.stripeCustomerId);
    }

    for (const tx of grantTransactions) {
      if (tx.stripeInvoiceId) {
        invoiceIds.add(tx.stripeInvoiceId);
      }
    }

    try {
      const mirroredInvoices: Array<{ stripeInvoiceId: string }> = await ctx.runQuery(
        components.stripe.public.listInvoicesByUserId,
        {
          userId: user._id,
        },
      );
      for (const invoice of mirroredInvoices) {
        invoiceIds.add(invoice.stripeInvoiceId);
      }
    } catch (error) {
      console.warn("[getLatestGrantStatus] Failed to query Stripe invoice mirror", error);
    }

    const objectIds = new Set<string>(invoiceIds);
    for (const subscriptionId of subscriptionIds) {
      objectIds.add(subscriptionId);
    }
    for (const stripeCustomerId of stripeCustomerIds) {
      objectIds.add(stripeCustomerId);
    }

    const eventRows: Array<{
      status: string;
      classification?: string;
      lastError?: string;
      eventType: string;
      updatedAt: number;
    }> = [];

    for (const objectId of objectIds) {
      const rows = await ctx.db
        .query("stripeEventLogs")
        .withIndex("by_object_created", (q) => q.eq("stripeObjectId", objectId))
        .order("desc")
        .take(5);

      for (const row of rows) {
        eventRows.push({
          status: row.status,
          classification: row.classification,
          lastError: row.lastError,
          eventType: row.eventType,
          updatedAt: row.updatedAt,
        });
      }
    }

    const latestRelevantEvent = selectLatestTrackedGrantEvent(eventRows);

    return {
      lastGrantAt: lastGrant?.createdAt,
      lastGrantInvoiceId: lastGrant?.stripeInvoiceId,
      latestEventStatus: latestRelevantEvent?.status,
      latestEventClassification: latestRelevantEvent?.classification,
      latestEventError: latestRelevantEvent?.lastError,
      latestEventUpdatedAt: latestRelevantEvent?.updatedAt,
    };
  },
});

const transactionTypeValidator = v.union(
  v.literal("purchase"),
  v.literal("usage"),
  v.literal("grant"),
  v.literal("refund"),
  v.literal("expiry"),
);

const creditTypeValidator = v.union(v.literal("free"), v.literal("paid"));

/**
 * Paginated ledger for the signed-in user. Split from `getTransactions`
 * because `usePaginatedQuery` cannot type-narrow a union return shape;
 * the two queries exist side-by-side until plan 03 migrates the UI
 * caller and the old query retires.
 *
 * Server-side narrowing:
 * - `jobId` → `by_job` index (O(rows-for-job)); ownership enforced
 *   by post-filtering on creditsId.
 * - single `types[]` entry → `by_credits_type` index (O(user's txns of
 *   that type)).
 * - multi-type or no-type → `by_credits` index with in-scan post-filter.
 *
 * Post-filtering via `filter()` from convex-helpers, so pages are
 * refilled to `numItems` when the predicate drops rows; end-of-list is
 * signalled by `isDone`, not by `page.length < numItems`.
 */
export type EnrichedTransactionRow = Doc<"creditTransactions"> & {
  paperTitle: string | null;
  jobName: string | null;
};

export const listTransactionsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    types: v.optional(v.array(transactionTypeValidator)),
    creditPools: v.optional(v.array(creditTypeValidator)),
    billingTypes: v.optional(v.array(billingTypeValidator)),
    q: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    jobId: v.optional(v.id("extractionJobs")),
  },
  handler: async (ctx, args) => {
    const emptyPage = {
      page: [] as EnrichedTransactionRow[],
      isDone: true,
      continueCursor: "" as Cursor,
    };

    const user = await getCurrentUser(ctx);
    if (!user) return emptyPage;

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (!credits) return emptyPage;

    const { paginationOpts, types, creditPools, billingTypes, q, from, to, jobId } = args;
    const creditsId = credits._id;
    const searchText = q?.trim().toLowerCase() ?? "";

    const matchesAllFilters = (row: Doc<"creditTransactions">): boolean => {
      if (row.creditsId !== creditsId) return false;
      if (types && types.length > 0 && !types.includes(row.type)) return false;
      if (creditPools && creditPools.length > 0 && !creditPools.includes(row.creditType)) return false;
      if (billingTypes && billingTypes.length > 0) {
        if (!row.billingType || !billingTypes.includes(row.billingType)) return false;
      }
      if (from !== undefined && row.createdAt < from) return false;
      if (to !== undefined && row.createdAt > to) return false;
      return true;
    };

    let basePage: {
      page: Doc<"creditTransactions">[];
      isDone: boolean;
      continueCursor: Cursor;
    };

    if (searchText.length > 0) {
      // Search-index path. Applies filter-fields narrowing inline.
      // Sorts by search relevance, not createdAt — the toolbar's sort
      // menu collapses grouping in that case.
      const base = ctx.db
        .query("creditTransactions")
        .withSearchIndex("search_transactions", (sq) => {
          let s = sq.search("searchableText", searchText).eq("creditsId", creditsId);
          if (types && types.length === 1) s = s.eq("type", types[0]);
          if (creditPools && creditPools.length === 1) s = s.eq("creditType", creditPools[0]);
          if (billingTypes && billingTypes.length === 1) s = s.eq("billingType", billingTypes[0]);
          return s;
        });
      basePage = await filter(base, matchesAllFilters).paginate(paginationOpts);
    } else if (jobId) {
      const base = ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (ix) => ix.eq("jobId", jobId))
        .order("desc");
      basePage = await filter(base, matchesAllFilters).paginate(paginationOpts);
    } else if (types && types.length === 1) {
      const only = types[0];
      const base = ctx.db
        .query("creditTransactions")
        .withIndex("by_credits_type", (ix) =>
          ix.eq("creditsId", creditsId).eq("type", only),
        )
        .order("desc");
      basePage = await filter(base, matchesAllFilters).paginate(paginationOpts);
    } else if (types && types.length > 1) {
      // Multi-type filter (e.g. refunds+grants). Walking the generic
      // `by_credits` index and post-filtering would read every
      // transaction the user has. Instead, open one `by_credits_type`
      // stream per requested type and merge them in `_creationTime`
      // desc order — each substream reads only its own matching rows,
      // so the cost is O(matches) per type instead of O(all rows).
      const perTypeStreams = types.map((only) =>
        stream(ctx.db, schema)
          .query("creditTransactions")
          .withIndex("by_credits_type", (ix) =>
            ix.eq("creditsId", creditsId).eq("type", only),
          )
          .order("desc"),
      );
      basePage = await mergedStream(perTypeStreams, ["_creationTime"])
        .filterWith(async (row) => matchesAllFilters(row))
        .paginate(paginationOpts);
    } else if (creditPools && creditPools.length === 1) {
      const only = creditPools[0];
      const base = ctx.db
        .query("creditTransactions")
        .withIndex("by_credits_creditType", (ix) =>
          ix.eq("creditsId", creditsId).eq("creditType", only),
        )
        .order("desc");
      basePage = await filter(base, matchesAllFilters).paginate(paginationOpts);
    } else if (billingTypes && billingTypes.length === 1) {
      const only = billingTypes[0];
      const base = ctx.db
        .query("creditTransactions")
        .withIndex("by_credits_billingType", (ix) =>
          ix.eq("creditsId", creditsId).eq("billingType", only),
        )
        .order("desc");
      basePage = await filter(base, matchesAllFilters).paginate(paginationOpts);
    } else if (from !== undefined || to !== undefined) {
      const base = ctx.db
        .query("creditTransactions")
        .withIndex("by_credits_createdAt", (ix) => {
          const k = ix.eq("creditsId", creditsId);
          if (from !== undefined && to !== undefined) return k.gte("createdAt", from).lte("createdAt", to);
          if (from !== undefined) return k.gte("createdAt", from);
          return k.lte("createdAt", to!);
        })
        .order("desc");
      basePage = await filter(base, matchesAllFilters).paginate(paginationOpts);
    } else {
      const base = ctx.db
        .query("creditTransactions")
        .withIndex("by_credits", (ix) => ix.eq("creditsId", creditsId))
        .order("desc");
      basePage = await filter(base, matchesAllFilters).paginate(paginationOpts);
    }

    const enrichedPage = await enrichRowsWithPaperAndJob(ctx, basePage.page);
    return {
      page: enrichedPage,
      isDone: basePage.isDone,
      continueCursor: basePage.continueCursor,
    };
  },
});

/**
 * Raw variant of `listTransactionsPaginated` — same args, same routing, but
 * returns bare `Doc<"creditTransactions">` rows without the per-page
 * paper/job enrichment join.
 *
 * Paired with `resolveTransactionEnrichments` and the client-side
 * `createEnrichmentCache` in `components/billing/transactions/transactions-panel-client.tsx`'s
 * `fetchAll`, so a multi-page export only enriches each unique paper/job
 * once across the entire export (not once per page).
 *
 * The live panel subscription keeps using the enriched
 * `listTransactionsPaginated` — cross-page caching matters for the
 * export drain, not for the ~25-row realtime page.
 */
export const listTransactionsPaginatedRaw = query({
  args: {
    paginationOpts: paginationOptsValidator,
    types: v.optional(v.array(transactionTypeValidator)),
    creditPools: v.optional(v.array(creditTypeValidator)),
    billingTypes: v.optional(v.array(billingTypeValidator)),
    q: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    jobId: v.optional(v.id("extractionJobs")),
  },
  handler: async (ctx, args) => {
    const emptyPage = {
      page: [] as Doc<"creditTransactions">[],
      isDone: true,
      continueCursor: "" as Cursor,
    };

    const user = await getCurrentUser(ctx);
    if (!user) return emptyPage;

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!credits) return emptyPage;

    const { paginationOpts, types, creditPools, billingTypes, q, from, to, jobId } = args;
    const creditsId = credits._id;
    const searchText = q?.trim().toLowerCase() ?? "";

    const matchesAllFilters = (row: Doc<"creditTransactions">): boolean => {
      if (row.creditsId !== creditsId) return false;
      if (types && types.length > 0 && !types.includes(row.type)) return false;
      if (creditPools && creditPools.length > 0 && !creditPools.includes(row.creditType)) return false;
      if (billingTypes && billingTypes.length > 0) {
        if (!row.billingType || !billingTypes.includes(row.billingType)) return false;
      }
      if (from !== undefined && row.createdAt < from) return false;
      if (to !== undefined && row.createdAt > to) return false;
      return true;
    };

    let basePage: {
      page: Doc<"creditTransactions">[];
      isDone: boolean;
      continueCursor: Cursor;
    };

    if (searchText.length > 0) {
      const base = ctx.db
        .query("creditTransactions")
        .withSearchIndex("search_transactions", (sq) => {
          let s = sq.search("searchableText", searchText).eq("creditsId", creditsId);
          if (types && types.length === 1) s = s.eq("type", types[0]);
          if (creditPools && creditPools.length === 1) s = s.eq("creditType", creditPools[0]);
          if (billingTypes && billingTypes.length === 1) s = s.eq("billingType", billingTypes[0]);
          return s;
        });
      basePage = await filter(base, matchesAllFilters).paginate(paginationOpts);
    } else if (jobId) {
      const base = ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (ix) => ix.eq("jobId", jobId))
        .order("desc");
      basePage = await filter(base, matchesAllFilters).paginate(paginationOpts);
    } else if (types && types.length === 1) {
      const base = ctx.db
        .query("creditTransactions")
        .withIndex("by_credits_type", (ix) => ix.eq("creditsId", creditsId).eq("type", types[0]))
        .order("desc");
      basePage = await filter(base, matchesAllFilters).paginate(paginationOpts);
    } else if (types && types.length > 1) {
      // Mirror of the enriched query's multi-type branch — keeps the
      // export drain on the same O(matches) path.
      const perTypeStreams = types.map((only) =>
        stream(ctx.db, schema)
          .query("creditTransactions")
          .withIndex("by_credits_type", (ix) =>
            ix.eq("creditsId", creditsId).eq("type", only),
          )
          .order("desc"),
      );
      basePage = await mergedStream(perTypeStreams, ["_creationTime"])
        .filterWith(async (row) => matchesAllFilters(row))
        .paginate(paginationOpts);
    } else if (creditPools && creditPools.length === 1) {
      const base = ctx.db
        .query("creditTransactions")
        .withIndex("by_credits_creditType", (ix) =>
          ix.eq("creditsId", creditsId).eq("creditType", creditPools[0]),
        )
        .order("desc");
      basePage = await filter(base, matchesAllFilters).paginate(paginationOpts);
    } else if (billingTypes && billingTypes.length === 1) {
      const base = ctx.db
        .query("creditTransactions")
        .withIndex("by_credits_billingType", (ix) =>
          ix.eq("creditsId", creditsId).eq("billingType", billingTypes[0]),
        )
        .order("desc");
      basePage = await filter(base, matchesAllFilters).paginate(paginationOpts);
    } else if (from !== undefined || to !== undefined) {
      const base = ctx.db
        .query("creditTransactions")
        .withIndex("by_credits_createdAt", (ix) => {
          const k = ix.eq("creditsId", creditsId);
          if (from !== undefined && to !== undefined) return k.gte("createdAt", from).lte("createdAt", to);
          if (from !== undefined) return k.gte("createdAt", from);
          return k.lte("createdAt", to!);
        })
        .order("desc");
      basePage = await filter(base, matchesAllFilters).paginate(paginationOpts);
    } else {
      const base = ctx.db
        .query("creditTransactions")
        .withIndex("by_credits", (ix) => ix.eq("creditsId", creditsId))
        .order("desc");
      basePage = await filter(base, matchesAllFilters).paginate(paginationOpts);
    }

    return {
      page: basePage.page,
      isDone: basePage.isDone,
      continueCursor: basePage.continueCursor,
    };
  },
});

/**
 * Batch-resolves paper titles + job names for a set of ids. Called by
 * the client-side export `fetchAll` loop, once per page with only the
 * novel ids not yet in its enrichment cache.
 *
 * Ownership check: only returns job names for jobs owned by the caller;
 * silent drop for foreign jobIds.
 */
export const resolveTransactionEnrichments = query({
  args: {
    paperIds: v.array(v.id("extractionPapers")),
    openalexIds: v.array(v.string()),
    jobIds: v.array(v.id("extractionJobs")),
  },
  returns: v.object({
    paperTitleById: v.record(v.string(), v.string()),
    paperTitleByOpenalex: v.record(v.string(), v.string()),
    jobNameById: v.record(v.string(), v.string()),
  }),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const empty = {
      paperTitleById: {} as Record<string, string>,
      paperTitleByOpenalex: {} as Record<string, string>,
      jobNameById: {} as Record<string, string>,
    };
    if (!user) return empty;

    const paperTitleById: Record<string, string> = {};
    const paperTitleByOpenalex: Record<string, string> = {};
    const jobNameById: Record<string, string> = {};

    await Promise.all(
      args.paperIds.map(async (id) => {
        const paper = await ctx.db.get(id);
        if (paper) paperTitleById[id] = paper.title;
      }),
    );

    await Promise.all(
      args.openalexIds.map(async (openalexId) => {
        const paper = await ctx.db
          .query("extractionPapers")
          .withIndex("by_openalex", (q) => q.eq("openalexId", openalexId))
          .first();
        if (paper) paperTitleByOpenalex[openalexId] = paper.title;
      }),
    );

    await Promise.all(
      args.jobIds.map(async (id) => {
        const job = await ctx.db.get(id);
        if (job && job.userId === user._id) jobNameById[id] = job.name;
      }),
    );

    return { paperTitleById, paperTitleByOpenalex, jobNameById };
  },
});

/**
 * Joins paperTitle + jobName onto each row. Papers are resolved in this
 * order: (1) typed paperId (`by id`), (2) metadata.openalexId (`by_openalex`
 * index). Jobs are resolved via typed jobId. Each distinct key is fetched
 * at most once per page.
 */
async function enrichRowsWithPaperAndJob(
  ctx: QueryCtx,
  rows: readonly Doc<"creditTransactions">[],
): Promise<EnrichedTransactionRow[]> {
  const paperIds = new Set<Id<"extractionPapers">>();
  const openalexIds = new Set<string>();
  const jobIds = new Set<Id<"extractionJobs">>();
  for (const row of rows) {
    if (row.paperId) paperIds.add(row.paperId);
    else {
      const openalexId = row.metadata?.openalexId;
      if (openalexId) openalexIds.add(openalexId);
    }
    if (row.jobId) jobIds.add(row.jobId);
  }

  const paperTitleById = new Map<Id<"extractionPapers">, string>();
  await Promise.all(
    Array.from(paperIds).map(async (id) => {
      const paper = await ctx.db.get(id);
      if (paper) paperTitleById.set(id, paper.title);
    }),
  );

  const paperTitleByOpenalex = new Map<string, string>();
  await Promise.all(
    Array.from(openalexIds).map(async (openalexId) => {
      const paper = await ctx.db
        .query("extractionPapers")
        .withIndex("by_openalex", (q) => q.eq("openalexId", openalexId))
        .first();
      if (paper) paperTitleByOpenalex.set(openalexId, paper.title);
    }),
  );

  const jobNameById = new Map<Id<"extractionJobs">, string>();
  await Promise.all(
    Array.from(jobIds).map(async (id) => {
      const job = await ctx.db.get(id);
      if (job) jobNameById.set(id, job.name);
    }),
  );

  return rows.map((row) => {
    let paperTitle: string | null = null;
    if (row.paperId) {
      paperTitle = paperTitleById.get(row.paperId) ?? null;
    }
    if (!paperTitle) {
      const openalexId = row.metadata?.openalexId;
      if (openalexId) {
        paperTitle = paperTitleByOpenalex.get(openalexId) ?? null;
      }
    }
    const jobName = row.jobId ? (jobNameById.get(row.jobId) ?? null) : null;
    return { ...row, paperTitle, jobName };
  });
}

/**
 * Faceted-count badges for the filter dropdowns — reactive, page-independent.
 *
 * Returns per-user counts for every literal of `type`, `creditType`, and
 * `billingType`, optionally bounded by a date range. Backed by the three
 * aggregate components registered in `convex/convex.config.ts`; three
 * component round-trips per call (one per dimension, each batched by
 * `countBatch`) regardless of the user's ledger size. Replaces the
 * page-local `counts` memo in `transactions-panel-client.tsx` which drifted
 * upward as the user infinite-scrolled.
 *
 * Convention A (date-respected, other-facets-ignored) — see
 * `plans/billing-transactions-perf/00-README.md` §D4.
 */
export const getTransactionFacetCounts = query({
  args: {
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  returns: v.union(
    v.object({
      type: v.record(v.string(), v.number()),
      creditPool: v.record(v.string(), v.number()),
      billingType: v.record(v.string(), v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!credits) return null;

    const dateRange =
      args.from !== undefined && args.to !== undefined
        ? { from: args.from, to: args.to }
        : null;

    return await readTransactionFacetCounts(ctx, credits._id, dateRange);
  },
});
