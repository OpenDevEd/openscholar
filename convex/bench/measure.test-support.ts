/**
 * Measures what one call reads at a given size (#631): documents read, bytes read, index
 * ranges and time, from the transaction's own metrics (`ctx.meta.getTransactionMetrics`),
 * under Convex's limits (tests/convex-test-with-limits.ts). A call that passes a limit is
 * recorded as failing, with why. Rows go to bench-results/<BENCH_LABEL>.json, which
 * scripts/bench-table.mjs turns into before-and-after tables.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Runner = { run: <T>(fn: (ctx: any) => Promise<T>) => Promise<T> };

export type Row = {
  area: string;
  scenario: string;
  size: number;
  ok: boolean;
  documentsRead?: number;
  bytesRead?: number;
  indexRanges?: number;
  ms?: number;
  /** What the call returned that the scenario checks, such as how many rows a page held. */
  result?: string;
  error?: string;
};

const rows: Row[] = [];
/** The real clock, taken before a test fakes timers. */
export const now = performance.now.bind(performance);

/** The transaction's metrics so far, through the syscall `ctx.meta.getTransactionMetrics` makes. */
async function metrics() {
  const read = JSON.parse(await (globalThis as unknown as { Convex: { asyncSyscall(op: string, args: string): Promise<string> } }).Convex.asyncSyscall("1.0/getTransactionMetrics", "{}"));
  return { documentsRead: read.documentsRead.used as number, bytesRead: read.bytesRead.used as number, indexRanges: read.databaseQueries.used as number };
}

/**
 * Runs `call` in one transaction as `t` and records what it read. `describe` says what it
 * returned, and `right`, whether that's the right answer: a count that stopped at a cap, or a
 * page that left papers out, fails though it fit Convex's limits.
 */
export async function measure<T>(t: Runner, where: { area: string; scenario: string; size: number }, call: (ctx: any) => Promise<T>, describe?: (result: T) => string, right?: (result: T) => boolean): Promise<T | undefined> {
  const started = now();
  try {
    const { result, read } = await t.run(async (ctx) => {
      const result = await call(ctx);
      return { result, read: await metrics() };
    });
    const correct = right ? right(result) : true;
    rows.push({ ...where, ok: correct, ...read, ms: Math.round(now() - started), ...(describe ? { result: describe(result) } : {}), ...(correct ? {} : { error: "wrong answer" }) });
    return result;
  } catch (error) {
    rows.push({ ...where, ok: false, ms: Math.round(now() - started), error: String(error instanceof Error ? error.message : error).split("\n")[0].slice(0, 160) });
    return undefined;
  }
}

/** The current transaction's metrics, for a flow that measures each of its calls itself. */
export const transactionMetrics = metrics;

/** Records a scenario measured another way, such as a flow of several calls. */
export const record = (row: Row) => rows.push(row);

/** Writes the rows measured in this file into the label's results, replacing this file's earlier ones. */
export function save(file: string) {
  const label = process.env.BENCH_LABEL ?? "local";
  const dir = path.resolve(__dirname, "../../bench-results");
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${label}.json`);
  let all: Record<string, Row[]> = {};
  try {
    all = JSON.parse(readFileSync(out, "utf8"));
  } catch {
    // First file of this label.
  }
  all[path.basename(file)] = rows.splice(0);
  writeFileSync(out, JSON.stringify(all, null, 2));
}
