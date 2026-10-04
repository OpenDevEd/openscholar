import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation, type MutationCtx } from "../lib/functions";
import { authorMetadata, metadataFromPaperData } from "../../lib/library/paper-metadata";
import { workUrl } from "../../lib/openalex/work-id";
import { MAX_AUTHORS } from "../lib/listCaps";

const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });
/** A larger history stays unparsed; its incomplete candidate list cannot establish names. */
const RECOVERY_LIMIT = 20;
const fields = ["authors", "authorsUnparsed", "journal", "citedByCount", "workType", "isOpenAccess", "oaStatus", "oaUrl", "pdfUrl", "metadataVersion", "metadataRecoveredAt"] as const;
type Stored = Omit<Doc<"libraryItems">, "_id" | "_creationTime" | "userId">;
type BeforeNarrowing = Omit<Stored, "authors"> & { authors?: string | string[] };
type Patch = Partial<Pick<Stored, typeof fields[number]>>;

function snapshot(item: Patch): string {
  return JSON.stringify(Object.fromEntries(fields.filter((key) => item[key] !== undefined).map((key) => [key, item[key]])));
}

/** Reads only retained snapshots from the same owner; never refetches historical inputs. */
export async function recoverMetadata(ctx: MutationCtx, userId: Id<"users">, item: Stored): Promise<Patch | undefined> {
  if (item.metadataVersion === 2) return;
  const names = authorMetadata(item);
  const canonical = workUrl(item.openalexId);
  const ids = [...new Set([item.openalexId, canonical, canonical?.split("/").at(-1)].filter((id): id is string => !!id))];
  const candidates: Doc<"screeningResults">[] = [];
  let complete = true;
  for (const id of ids) {
    const found = await ctx.db.query("screeningResults").withIndex("by_openalexId", (q) => q.eq("openalexId", id)).take(RECOVERY_LIMIT + 1);
    if (found.length > RECOVERY_LIMIT) { complete = false; break; }
    for (const result of found) {
      if ((await ctx.db.get("screeningJobs", result.jobId))?.userId === userId) candidates.push(result);
    }
  }
  const patch: Patch = { authors: names.authors, authorsUnparsed: names.authorsUnparsed, metadataVersion: 2 };
  if (patch.authors && patch.authors.length > MAX_AUTHORS) {
    patch.authorsUnparsed = patch.authors.join(", ");
    patch.authors = undefined;
  }
  if (complete) {
    if (!names.authors && names.authorsUnparsed) {
      const matching = candidates.flatMap((paper) => paper.authors?.length && paper.authors.join(", ") === names.authorsUnparsed ? [paper.authors] : []);
      const distinct = [...new Set(matching.map((authors) => JSON.stringify(authors)))];
      if (distinct.length === 1 && matching[0].length <= MAX_AUTHORS) { patch.authors = matching[0]; patch.authorsUnparsed = undefined; }
    }
  }
  const raw = metadataFromPaperData(item.paperData);
  const sources = candidates.map((paper) => ({ journal: paper.venue, citedByCount: paper.citedByCount, workType: paper.workType, isOpenAccess: paper.isOpenAccess, oaStatus: paper.oaStatus, oaUrl: paper.oaUrl, pdfUrl: paper.pdfUrl }));
  for (const key of ["journal", "citedByCount", "workType", "isOpenAccess", "oaStatus", "oaUrl", "pdfUrl"] as const) {
    if (item[key] !== undefined && item[key] !== "") continue;
    const values = raw[key] !== undefined && raw[key] !== "" ? [raw[key]] : complete ? [...new Set(sources.map((source) => source[key]).filter((value) => value !== undefined && value !== ""))] : [];
    if (values.length === 1) Object.assign(patch, { [key]: values[0] });
  }
  if (patch.authors || Object.keys(patch).some((key) => !["authors", "authorsUnparsed", "metadataVersion"].includes(key))) patch.metadataRecoveredAt = Date.now();
  return patch;
}

async function receipt(ctx: MutationCtx, table: "libraryItems" | "libraryRemovals", recordId: string, before: Stored, patch: Patch) {
  await ctx.db.insert("paperMetadataChanges", { table, recordId, before: snapshot(before), after: snapshot({ ...before, ...patch }), createdAt: Date.now() });
}

// One record per transaction bounds its source reads even when every candidate has a long abstract.
export const papers = migrations.define({ table: "libraryItems", batchSize: 1, migrateOne: async (ctx, item) => {
  const patch = await recoverMetadata(ctx, item.userId, item);
  if (!patch) return;
  await receipt(ctx, "libraryItems", item._id, item, patch);
  return patch;
} });

export const removals = migrations.define({ table: "libraryRemovals", batchSize: 1, migrateOne: async (ctx, row) => {
  const patch = await recoverMetadata(ctx, row.userId, row.item);
  if (!patch) return;
  await receipt(ctx, "libraryRemovals", row._id, row.item, patch);
  return { item: { ...row.item, ...patch } };
} });

export const run = migrations.runner([internal.migrations.paperMetadata.papers, internal.migrations.paperMetadata.removals]);

/** A rollback never changes a personal rating, membership or later metadata edit. */
export const rollback = internalMutation({
  args: { changeId: v.id("paperMetadataChanges") }, returns: v.boolean(),
  handler: async (ctx, { changeId }) => {
    const change = await ctx.db.get("paperMetadataChanges", changeId);
    if (!change || change.revertedAt !== undefined) return false;
    const patch = Object.fromEntries(fields.map((key) => [key, undefined])) as Patch;
    const before = JSON.parse(change.before) as Partial<BeforeNarrowing>;
    // Keep receipt bytes unchanged and restore names in the narrowed shape.
    // Version 2 makes rollback terminal so rerunning recovery cannot undo the rollback.
    const names = authorMetadata({ authors: Array.isArray(before.authors) ? before.authors : undefined, authorsUnparsed: typeof before.authors === "string" ? before.authors : before.authorsUnparsed });
    Object.assign(patch, before, { authors: names.authors, authorsUnparsed: names.authorsUnparsed, metadataVersion: 2 });
    if (change.table === "libraryItems") {
      const id = ctx.db.normalizeId("libraryItems", change.recordId);
      const item = id && await ctx.db.get("libraryItems", id);
      if (!item || snapshot(item) !== change.after) throw new Error("Metadata changed after migration; rollback refused.");
      await ctx.db.patch("libraryItems", item._id, patch);
    } else {
      const id = ctx.db.normalizeId("libraryRemovals", change.recordId);
      const row = id && await ctx.db.get("libraryRemovals", id);
      if (!row || snapshot(row.item) !== change.after) throw new Error("Metadata changed after migration; rollback refused.");
      await ctx.db.patch("libraryRemovals", row._id, { item: { ...row.item, ...patch } });
    }
    await ctx.db.patch("paperMetadataChanges", changeId, { revertedAt: Date.now() });
    return true;
  },
});

const stats = { total: v.number(), remaining: v.number(), arrays: v.number(), unparsed: v.number(), missing: v.number() };
type Stats = { total: number; remaining: number; arrays: number; unparsed: number; missing: number };
export const verifyPage = internalQuery({
  args: { table: v.union(v.literal("libraryItems"), v.literal("libraryRemovals")), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ ...stats, isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ cursor, numItems: 100, maximumBytesRead: 4 * 1024 * 1024 });
    const count: Stats = { total: page.page.length, remaining: 0, arrays: 0, unparsed: 0, missing: 0 };
    for (const row of page.page) {
      const item = "item" in row ? row.item : row;
      if (item.metadataVersion !== 2) count.remaining++;
      if (item.authors?.length) count.arrays++;
      else if (item.authorsUnparsed) count.unparsed++;
      else count.missing++;
    }
    return { ...count, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const verify = internalAction({
  args: {}, returns: v.object({ library: v.object(stats), removals: v.object(stats) }),
  handler: async (ctx): Promise<{ library: Stats; removals: Stats }> => {
    const result = { library: { total: 0, remaining: 0, arrays: 0, unparsed: 0, missing: 0 }, removals: { total: 0, remaining: 0, arrays: 0, unparsed: 0, missing: 0 } };
    for (const [key, table] of [["library", "libraryItems"], ["removals", "libraryRemovals"]] as const) {
      let cursor: string | null = null;
      for (;;) {
        const page: Stats & { isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.paperMetadata.verifyPage, { table, cursor });
        for (const field of ["total", "remaining", "arrays", "unparsed", "missing"] as const) result[key][field] += page[field];
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return result;
  },
});
