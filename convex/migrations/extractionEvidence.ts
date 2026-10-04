import { Migrations } from "@convex-dev/migrations";
import { convexToJson, v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { validateResultEvidence } from "../extraction/mutations/results";

const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });
const fields = ["citations", "citationStatus", "retrievalDiagnostics", "evidenceVersion", "evidenceRepairedAt"] as const;
type Evidence = Pick<Doc<"extractionResults">, typeof fields[number]>;
const snapshot = (row: Partial<Evidence>) => JSON.stringify(convexToJson(Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]]))));
const answerSnapshot = (row: Doc<"extractionResults">) => JSON.stringify([row.paperId, row.questionKey, row.answer, row.confidence, row.modelConfidence, row.reasoning, row.processedAt]);

export const results = migrations.define({ table: "extractionResults", batchSize: 10, migrateOne: async (ctx, row) => {
  if (row.evidenceVersion === 2) return;
  const paper = await ctx.db.get("extractionPapers", row.paperId);
  if (!paper) throw new Error(`Missing paper for extraction result ${row._id}; repair stopped.`);
  const validated = await validateResultEvidence(ctx, paper, row);
  const patch: Partial<Evidence> = { citations: validated.citations, citationStatus: validated.citationStatus, retrievalDiagnostics: validated.retrievalDiagnostics, evidenceVersion: 2 };
  const changed = snapshot({ citations: row.citations, citationStatus: row.citationStatus, retrievalDiagnostics: row.retrievalDiagnostics }) !== snapshot({ citations: patch.citations, citationStatus: patch.citationStatus, retrievalDiagnostics: patch.retrievalDiagnostics });
  if (changed) patch.evidenceRepairedAt = Date.now();
  await ctx.db.insert("extractionEvidenceChanges", { jobId: row.jobId, resultId: row._id, before: snapshot(row), after: snapshot({ ...row, ...patch }), answerSnapshot: answerSnapshot(row), createdAt: Date.now() });
  return patch;
} });

export const run = migrations.runner([internal.migrations.extractionEvidence.results]);

export const rollback = internalMutation({
  args: { changeId: v.id("extractionEvidenceChanges") }, returns: v.boolean(),
  handler: async (ctx, { changeId }) => {
    const change = await ctx.db.get("extractionEvidenceChanges", changeId);
    if (!change || change.revertedAt !== undefined) return false;
    const row = await ctx.db.get("extractionResults", change.resultId);
    if (!row || snapshot(row) !== snapshot(JSON.parse(change.after)) || answerSnapshot(row) !== change.answerSnapshot) throw new Error("Extraction changed after repair; rollback refused.");
    const patch = Object.fromEntries(fields.map(key => [key, undefined])) as Partial<Evidence>;
    Object.assign(patch, JSON.parse(change.before) as Evidence);
    await ctx.db.patch("extractionResults", row._id, patch);
    await ctx.db.patch("extractionEvidenceChanges", changeId, { revertedAt: Date.now() });
    return true;
  },
});

const stats = { total: v.number(), remaining: v.number(), groundedWithoutCitations: v.number(), legacyCitations: v.number() };
type Stats = { total: number; remaining: number; groundedWithoutCitations: number; legacyCitations: number };
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ ...stats, isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("extractionResults").paginate({ cursor, numItems: 100, maximumBytesRead: 4 * 1024 * 1024 });
    const count: Stats = { total: page.page.length, remaining: 0, groundedWithoutCitations: 0, legacyCitations: 0 };
    for (const row of page.page) {
      if (row.evidenceVersion !== 2) count.remaining++;
      if (row.citationStatus === "grounded" && (!row.citations.length || row.answer === null)) count.groundedWithoutCitations++;
      count.legacyCitations += row.citations.filter(c => !c.source || !c.paperId || !c.sourceHash).length;
    }
    return { ...count, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const verify = internalAction({
  args: {}, returns: v.object(stats),
  handler: async (ctx): Promise<Stats> => {
    const result: Stats = { total: 0, remaining: 0, groundedWithoutCitations: 0, legacyCitations: 0 };
    let cursor: string | null = null;
    for (;;) {
      const page: Stats & { isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.extractionEvidence.verifyPage, { cursor });
      for (const key of ["total", "remaining", "groundedWithoutCitations", "legacyCitations"] as const) result[key] += page[key];
      if (page.isDone) return result;
      cursor = page.continueCursor;
    }
  },
});
