// What a screening costs as it grows (#631, #635): starting a job of that many papers, a page of one
// outcome, a search of its papers, its card, and an export of every result.
import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeEach, describe, it, vi } from "vitest";
import schema from "../schema";
import { listAction } from "../screening/papers";
import { createScreeningJobForUser } from "../screening/mutations";
import { getScreeningJobAction, listScreeningResultsAction } from "../screening/queries";
import { insertMany, seedAccount, text } from "../lib/maxSize.test-support";
import { insertJob } from "../screening/createJob.test-support";
import { measure, now, record, save } from "./measure.test-support";

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
      const { userId } = await seedAccount(t);
      // Credits enough for any size, so only the job's own limits can refuse it.
      await t.run((ctx) => ctx.db.insert("billingAccounts", { userId, plan: "pro", pastDue: false, balance: 1e9, purchased: 0, signupGranted: true, hasPaid: true, refreshedAt: 1 }));
      const at = (scenario: string) => ({ area: "screening", scenario, size });
      // Starting a job of this many papers, as screening/start:screen does once it has read them.
      const papers = Array.from({ length: size }, (_, i) => ({ openalexId: `W${i}`, title: text(120, i) }));
      await measure(t, at("start a job"), (ctx) => (createScreeningJobForUser as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<{ jobId: string }> })._handler(ctx, { userId, author: "user", papers, set: { kind: "saved" }, first: 1, last: size, questions, scoringConfig }), () => "started");

      // A finished job of this size, seeded as rows.
      const jobId = await t.run((ctx) => insertJob(ctx, { userId, status: "completed", totalPapers: size, questions, scoringConfig, createdAt: 1, updatedAt: 1 } as never));
      await insertMany(t, "screeningResults", Array.from({ length: size }, (_, i) => ({
        jobId, openalexId: `W${i}`, title: text(120, i), abstract: text(1_200, i), authors: [text(40, i), text(40, i + 3)], publicationYear: 2000 + (i % 25),
        status: "completed", answers: { "Is this a randomized trial?": i % 4 === 0 }, outcome: OUTCOMES[i % 4], qualified: i % 4 === 0, score: i % 4 === 0 ? 1 : 0, stars: 1, createdAt: 1,
      })));
      const rows = (read: { page: unknown[] } | undefined) => `${read?.page.length ?? 0} rows`;
      await measure(t, at("page of included papers"), (ctx) => listAction.run(ctx, userId, { jobId, outcome: "included", paginationOpts: { cursor: null, numItems: 50 } }), rows);
      // A word in one paper title in ten.
      // A word no paper has: the right answer is an empty last page.
      await measure(t, at("search of its papers, no match"), (ctx) => listAction.run(ctx, userId, { jobId, outcome: "excluded", text: "zzz-not-there", paginationOpts: { cursor: null, numItems: 50 } }), (r) => `${rows(r)}${r?.isDone ? "" : ", not done"}`, (r) => r.page.length === 0 && r.isDone);
      await measure(t, at("job card"), (ctx) => getScreeningJobAction.run(ctx, userId, { jobId }), (r: any) => (r ? `${r.totalPapers} papers` : "none"), (r: any) => r?.totalPapers === size);

      // An export reads every page of results in turn.
      let cursor: string | null = null;
      let calls = 0;
      let exported = 0;
      let most = { documentsRead: 0, bytesRead: 0 };
      let ok = true;
      const started = now();
      do {
        try {
          const { read, m } = await t.run(async (ctx) => {
            const read = await listScreeningResultsAction.run(ctx, userId, { jobId, paginationOpts: { cursor, numItems: 200 } });
            return { read, m: JSON.parse(await (globalThis as any).Convex.asyncSyscall("1.0/getTransactionMetrics", "{}")) };
          });
          calls += 1;
          exported += read.page.length;
          most = { documentsRead: Math.max(most.documentsRead, m.documentsRead.used), bytesRead: Math.max(most.bytesRead, m.bytesRead.used) };
          cursor = read.isDone ? null : read.continueCursor;
        } catch {
          ok = false;
          break;
        }
      } while (cursor !== null);
      record({ ...at("export, every page"), ok: ok && exported === size, ...most, ms: Math.round(now() - started), result: `${exported} results in ${calls} calls` });
    });
  }
});
