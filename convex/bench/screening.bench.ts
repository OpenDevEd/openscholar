// What a screening costs as it grows (#631, #635): starting a job of that many papers, a page of one
// outcome, a search of its papers, its card, and an export of every result.
import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeEach, describe, it, vi } from "vitest";
import schema from "../schema";
import { listAction } from "../screening/papers";
import { fillScreeningJob, openScreeningJob, searchTextOf } from "../screening/mutations";
import { setupScreeningWorkpool } from "../screening/workpool.test-support";
import { getScreeningJobAction, listScreeningResultsAction } from "../screening/queries";
import { insertMany, seedAccount, text } from "../lib/maxSize.test-support";
import { insertJob } from "../screening/createJob.test-support";
import { measure, now, record, save, transactionMetrics } from "./measure.test-support";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { ownActor } from "../workspaces/actor.test-support";

const SIZES = (process.env.BENCH_SIZES ?? "1000,5000,10000").split(",").map(Number);
const OUTCOMES = ["included", "excluded", "excluded", "unclear"] as const;
const questions = [{ key: "q1", question: "Is this a randomized trial?" }];
const scoringConfig = { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], minimumScore: 1, starThresholds: [{ minScore: 0, stars: 1 }] };

describe("screening reads by job size", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  afterAll(() => save(__filename));

  for (const size of SIZES) {
    it(`${size} papers`, async () => {
      const t = convexTest(schema);
      setupScreeningWorkpool(t);
      const { userId } = await seedAccount(t);
      // Resolved before any measured transaction, so its reads aren't counted as the core's.
      const actor = await t.run((ctx) => ownActor(ctx, userId));
      // Credits enough for any size, so only the job's own limits can refuse it.
      await t.run((ctx) => ctx.db.insert("billingAccounts", { userId, plan: "pro", pastDue: false, balance: 1e9, purchased: 0, signupGranted: true, hasPaid: true, refreshedAt: 1 }));
      const at = (scenario: string) => ({ area: "screening", scenario, size });
      // Starting a job of this many papers, as screening/start:screen does: it opens the job, then gives it its papers a step at a time.
      // The heaviest of those transactions is what counts against Convex's limits.
      const papers = Array.from({ length: size }, (_, i) => ({ openalexId: `W${i}`, title: text(120, i) }));
      // The mutations' own handlers wrap the database in the triggers: run them on the bare one, so they apply once.
      const handler = (fn: unknown) => (fn as { _handler: (ctx: unknown, args: unknown) => Promise<any> })._handler;
      const step = async <T,>(fn: (ctx: any) => Promise<T>) => runUntriggered(t, async (ctx) => ({ out: await fn(ctx), m: await transactionMetrics() }));
      const startedAt = now();
      let heaviest = { documentsRead: 0, bytesRead: 0, indexRanges: 0 };
      let steps = 0;
      let failure: string | undefined;
      try {
        const opened = await step((ctx) => handler(openScreeningJob)(ctx, { userId, author: "user", set: { kind: "saved" }, first: 1, last: size, papers: size, questions, scoringConfig }));
        heaviest = opened.m;
        for (let from = 0; from < size; from += 200) {
          const filled = await step((ctx) => handler(fillScreeningJob)(ctx, { jobId: opened.out.jobId, papers: papers.slice(from, from + 200), read: Math.min(200, size - from), answered: 0, ended: from + 200 >= size }));
          steps += 1;
          heaviest = { documentsRead: Math.max(heaviest.documentsRead, filled.m.documentsRead), bytesRead: Math.max(heaviest.bytesRead, filled.m.bytesRead), indexRanges: Math.max(heaviest.indexRanges, filled.m.indexRanges) };
        }
      } catch (thrown) {
        failure = `step ${steps + 1}: ${String((thrown as Error).message ?? thrown).split("\n")[0].slice(0, 160)}`;
      }
      record({ ...at("start a job"), ok: !failure, ...heaviest, ms: Math.round(now() - startedAt), result: `${steps} steps, the heaviest shown`, ...(failure ? { error: failure } : {}) });

      // A finished job of this size, seeded as rows.
      const jobId = await t.run((ctx) => insertJob(ctx, { userId, status: "completed", totalPapers: size, questions, scoringConfig, createdAt: 1, updatedAt: 1 } as never));
      await insertMany(t, "screeningResults", Array.from({ length: size }, (_, i) => ({
        jobId, openalexId: `W${i}`, title: text(120, i), abstract: text(1_200, i), authors: [text(40, i), text(40, i + 3)], publicationYear: 2000 + (i % 25),
        status: "completed", answers: { "Is this a randomized trial?": i % 4 === 0 }, outcome: OUTCOMES[i % 4], qualified: i % 4 === 0, score: i % 4 === 0 ? 1 : 0, stars: 1, createdAt: 1,
      })).map((row) => ({ ...row, searchText: searchTextOf(row) })));
      const rows = (read: { page: unknown[] } | undefined) => `${read?.page.length ?? 0} rows`;
      await measure(t, at("page of included papers"), (ctx) => listAction.run(ctx, actor, { jobId, outcome: "included", paginationOpts: { cursor: null, numItems: 50 } }), rows);
      // A word in one paper title in ten.
      // A word no paper has: the right answer is an empty last page.
      await measure(t, at("search of its papers, no match"), (ctx) => listAction.run(ctx, actor, { jobId, outcome: "excluded", text: "zzz-not-there", paginationOpts: { cursor: null, numItems: 50 } }), (r) => `${rows(r)}${r?.isDone ? "" : ", not done"}`, (r) => r.page.length === 0 && r.isDone);
      await measure(t, at("job card"), (ctx) => getScreeningJobAction.run(ctx, actor, { jobId }), (r: any) => (r ? `${r.totalPapers} papers` : "none"), (r: any) => r?.totalPapers === size);

      // An export reads every page of results in turn.
      let cursor: string | null = null;
      let calls = 0;
      let exported = 0;
      let most = { documentsRead: 0, bytesRead: 0 };
      let ok = true;
      let error: string | undefined;
      const started = now();
      do {
        try {
          const { read, m } = await t.run(async (ctx) => {
            const read = await listScreeningResultsAction.run(ctx, actor, { jobId, paginationOpts: { cursor, numItems: 200 } });
            return { read, m: JSON.parse(await (globalThis as any).Convex.asyncSyscall("1.0/getTransactionMetrics", "{}")) };
          });
          calls += 1;
          exported += read.page.length;
          most = { documentsRead: Math.max(most.documentsRead, m.documentsRead.used), bytesRead: Math.max(most.bytesRead, m.bytesRead.used) };
          cursor = read.isDone ? null : read.continueCursor;
        } catch (thrown) {
          ok = false;
          error = `call ${calls + 1}: ${String((thrown as Error).message ?? thrown).split("\n")[0]}`;
          break;
        }
      } while (cursor !== null);
      record({ ...at("export, every page"), ok: ok && exported === size, ...most, ms: Math.round(now() - started), result: `${exported} results in ${calls} calls`, ...(error ? { error } : {}) });
    });
  }
});
