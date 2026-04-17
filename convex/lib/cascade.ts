import type { MutationCtx } from "../_generated/server";

/**
 * Delete up to `batchSize` rows from `table` where `field` matches
 * `value` via `indexName`. Returns the number deleted.
 *
 * Designed for the self-rescheduling cascade-delete pattern: callers
 * loop a table with take(BATCH_SIZE), delete each match, reschedule
 * the outer mutation while the helper reports rows remaining.
 */
export async function batchDeleteByIndex(
  ctx: MutationCtx,
  table: string,
  indexName: string,
  field: string,
  value: unknown,
  batchSize = 100,
): Promise<number> {
  // Types are narrowed at call sites; the helper operates dynamically
  // so the cascade orchestrator can iterate a list of (table, index)
  // tuples without duplicating the scan-and-delete scaffolding for
  // each table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = ctx.db as any;
  const rows = await db
    .query(table)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .withIndex(indexName, (q: any) => q.eq(field, value))
    .take(batchSize);
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  return rows.length;
}
