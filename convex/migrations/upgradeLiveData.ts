import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { legacyPaperRef } from "../../lib/papers/paper-ref";
import { authorMetadata, metadataFromPaperData } from "../../lib/library/paper-metadata";
import { identityOf } from "../lib/paperRef";
import { MAX_AUTHORS } from "../lib/listCaps";
import { facetsOf } from "../library/facets";
import { collectionSortName } from "../library/sortName";
import { personalRatingRow, ratedPaper, rateItem } from "../ratings";
import { moveResultAnswers } from "../screening/drain";
import { startCount } from "../research/recordCounts";
import { ensureWorkspace } from "../workspaces/create";

/**
 * Brings the data on openscholar.ai, written by `main` before workspaces, up to `dev`'s shape, in
 * one run: the tables with rows there are the only ones it reads. It runs once, with schema
 * validation off, on a copy first and then on the live deployment. Everything is safe to run again.
 * Once it has run, validation goes back on and this file is deleted.
 *
 *   npx convex run migrations/upgradeLiveData:run
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** More than any workspace, collection or job on the live deployment holds. */
const MOST_ROWS = 20_000;

/** Stored fields `dev` no longer declares, on the rows this reads. */
type Legacy = {
  userId?: Id<"users">;
  openalexId?: string;
  authors?: string | string[];
  itemCount?: number;
  createdAt?: number;
};
const legacy = <T>(row: T) => row as T & Legacy;
const own = (ctx: MutationCtx, userId: Id<"users">) => ensureWorkspace(ctx, { kind: "personal", userId });

function identityFrom(table: string, row: { _id: string; openalexId?: string; doi?: string; pdfUrl?: string }) {
  const ref = row.openalexId ? legacyPaperRef(row.openalexId, { pdfUrl: row.pdfUrl }) : null;
  if (!ref) throw new Error(`${table} ${row._id} has no paper in "${row.openalexId}"`);
  return identityOf(ref, { openalexId: row.openalexId, doi: row.doi });
}

export const accounts = migrations.define({
  table: "users",
  batchSize: 50,
  migrateOne: async (ctx, user) => {
    await own(ctx, user._id);
    return { libraryItemCount: undefined } as never;
  },
});

export const collections = migrations.define({
  table: "collections",
  migrateOne: async (ctx, collection) => {
    const { userId, itemCount } = legacy(collection);
    if (!userId) return;
    return { workspaceId: await own(ctx, userId), createdBy: userId, sortName: collectionSortName(collection.name), itemCount: itemCount ?? 0, userId: undefined } as never;
  },
});

export const papers = migrations.define({
  table: "libraryItems",
  batchSize: 25,
  migrateOne: async (ctx, item) => {
    const old = legacy(item);
    if (!old.userId) return;
    const stored = typeof old.authors === "string" ? { authorsUnparsed: old.authors, paperData: item.paperData } : { authors: old.authors, paperData: item.paperData };
    const names = authorMetadata(stored);
    const authors = names.authors && names.authors.length > MAX_AUTHORS ? undefined : names.authors;
    const unparsed = names.authors && names.authors.length > MAX_AUTHORS ? names.authors.join(", ") : names.authorsUnparsed;
    // What its saved copy of the paper knows and the row was never given.
    const raw = metadataFromPaperData(item.paperData);
    const filled = Object.fromEntries(
      (["journal", "citedByCount", "workType", "isOpenAccess", "oaStatus", "oaUrl", "pdfUrl"] as const).flatMap((key) => {
        const value = raw[key];
        return (item[key] === undefined || item[key] === "") && value !== undefined && value !== "" ? [[key, value]] : [];
      }),
    );
    return {
      workspaceId: await own(ctx, old.userId),
      createdBy: old.userId,
      ...identityFrom("libraryItems", { _id: item._id, openalexId: old.openalexId, doi: item.doi, pdfUrl: item.pdfUrl }),
      authors,
      authorsUnparsed: unparsed,
      metadataVersion: 2,
      ...filled,
      userId: undefined,
      openalexId: undefined,
    } as never;
  },
});

/** A paper's rating was only ever its one saver's; it becomes theirs, and the paper takes it from them. */
export const ratings = migrations.define({
  table: "libraryItems",
  batchSize: 25,
  migrateOne: async (ctx, item) => {
    const { rating } = item;
    if (rating !== undefined && Number.isInteger(rating) && rating >= 0 && rating <= 5 && !(await personalRatingRow(ctx, item.createdBy, item.paperKey))) {
      await ctx.db.insert("ratings", { userId: item.createdBy, paperId: ratedPaper(item.paperKey), rating });
    }
    await rateItem(ctx, item);
  },
});

/** Each paper's place in a collection carries what its view sorts and filters by. */
export const memberships = migrations.define({
  table: "libraryItemCollections",
  batchSize: 25,
  migrateOne: async (ctx, membership) => {
    const item = await ctx.db.get("libraryItems", membership.libraryItemId);
    if (!item) throw new Error(`Membership ${membership._id} names no paper`);
    return { ...facetsOf(item), userId: undefined } as never;
  },
});

/** Each collection's papers, and each workspace's papers and collections, counted from the rows. */
export const collectionCounts = migrations.define({
  table: "collections",
  migrateOne: async (ctx, collection) => {
    const papersIn = await ctx.db.query("libraryItemCollections").withIndex("by_collection", (q) => q.eq("collectionId", collection._id)).take(MOST_ROWS);
    return { itemCount: papersIn.length };
  },
});

async function setCount(ctx: MutationCtx, table: "libraryCounts" | "collectionCounts", workspaceId: Id<"workspaces">, count: number) {
  const row = await ctx.db.query(table).withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
  if (row) await ctx.db.patch(table, row._id, { count });
  else await ctx.db.insert(table, { workspaceId, count });
}

export const workspaceCounts = migrations.define({
  table: "workspaces",
  batchSize: 10,
  migrateOne: async (ctx, workspace) => {
    const items = await ctx.db.query("libraryItems").withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id)).take(MOST_ROWS);
    await setCount(ctx, "libraryCounts", workspace._id, items.length);
    const made = await ctx.db.query("collections").withIndex("by_workspace_sortName", (q) => q.eq("workspaceId", workspace._id)).take(MOST_ROWS);
    if (made.length > 0) await setCount(ctx, "collectionCounts", workspace._id, made.length);
  },
});

export const walletKeys = migrations.define({
  table: "walletKeys",
  migrateOne: async (ctx, key) => (key.workspaceId === undefined ? { workspaceId: await own(ctx, key.userId) } : undefined),
});

/** A person's credits now live in Autumn. The rows stay for the ledger that names them. */
export const credits = migrations.define({
  table: "credits",
  batchSize: 200,
  migrateOne: (_ctx, row) => ({ createdAt: row.createdAt ?? Math.floor(row._creationTime), freeBalance: undefined, paidBalance: undefined, lifetimeUsed: undefined, lastUpdatedAt: undefined }) as never,
});

export const ledger = migrations.define({
  table: "creditTransactions",
  batchSize: 200,
  migrateOne: () => ({ balanceAfter: undefined }) as never,
});

/** Flags from before plan features, which name a tier. Shared dev's are copied in afterwards, and a second run leaves those. */
export const flags = migrations.define({
  table: "featureFlags",
  migrateOne: async (ctx, flag) => {
    if ("minimumTier" in flag) await ctx.db.delete("featureFlags", flag._id);
  },
});

export const screeningJobs = migrations.define({
  table: "screeningJobs",
  batchSize: 5,
  migrateOne: async (ctx, job) => {
    const { userId } = legacy(job);
    if (!userId) return;
    const workspaceId = await own(ctx, userId);
    const screeningId = await ctx.db.insert("screenings", { workspaceId, version: 0, createdAt: job.createdAt });
    return { workspaceId, createdBy: userId, screeningId, userId: undefined, workflowId: undefined, processedPapers: undefined, qualifiedPapers: undefined, failedPapers: undefined } as never;
  },
});

/** Each paper by its identity, its answers in its job's screening. A paper left running under a job that has ended never will finish. */
export const screeningResults = migrations.define({
  table: "screeningResults",
  batchSize: 25,
  migrateOne: async (ctx, result) => {
    const { openalexId } = legacy(result);
    if (!openalexId) return;
    await ctx.db.patch("screeningResults", result._id, {
      ...identityFrom("screeningResults", { _id: result._id, openalexId, doi: result.doi }),
      ...(result.status === "processing" ? { status: "skipped" as const } : {}),
      openalexId: undefined,
    } as never);
    const moved = (await ctx.db.get("screeningResults", result._id)) as Doc<"screeningResults">;
    await moveResultAnswers(ctx, moved);
  },
});

/** Each job's progress row, counted from its results, and each owner's count of their jobs. */
export const screeningProgress = migrations.define({
  table: "screeningJobs",
  batchSize: 2,
  migrateOne: async (ctx, job) => {
    const existing = await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", job._id)).unique();
    if (!existing) {
      const results = await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(MOST_ROWS);
      const count = (status: Doc<"screeningResults">["status"]) => results.filter((result) => result.status === status).length;
      await ctx.db.insert("screeningJobProgress", {
        jobId: job._id,
        completed: count("completed"),
        skipped: count("skipped"),
        failed: count("failed"),
        qualified: results.filter((result) => result.status === "completed" && result.qualified === true).length,
        credits: results.reduce((sum, result) => sum + (result.creditsUsed ?? 0), 0),
      });
    }
    await startCount(ctx, "screeningJobs", job);
  },
});

/** The count a job's trigger kept for the workspace it didn't have yet, as it moved into one. */
export const strayCounts = migrations.define({
  table: "recordCounts",
  migrateOne: async (ctx, row) => {
    if (row.workspaceId === undefined) await ctx.db.delete("recordCounts", row._id);
  },
});

export const run = migrations.runner([
  internal.migrations.upgradeLiveData.accounts,
  internal.migrations.upgradeLiveData.collections,
  internal.migrations.upgradeLiveData.papers,
  internal.migrations.upgradeLiveData.ratings,
  internal.migrations.upgradeLiveData.memberships,
  internal.migrations.upgradeLiveData.collectionCounts,
  internal.migrations.upgradeLiveData.workspaceCounts,
  internal.migrations.upgradeLiveData.walletKeys,
  internal.migrations.upgradeLiveData.credits,
  internal.migrations.upgradeLiveData.ledger,
  internal.migrations.upgradeLiveData.flags,
  internal.migrations.upgradeLiveData.screeningJobs,
  internal.migrations.upgradeLiveData.screeningResults,
  internal.migrations.upgradeLiveData.screeningProgress,
  internal.migrations.upgradeLiveData.strayCounts,
]);
