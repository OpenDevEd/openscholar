// What a screening with reviewers costs to read as it grows: the pages its people open (Screen's queues, Papers
// with its tabs and filters, a paper, the screening's header), the counts beside them, and what the rail and the
// list of screenings read. Seeded through the real mutations, so its cards, counts and settled results are the ones
// the product writes. `npm run bench`, BENCH_SIZES to change the sizes, BENCH_LABEL to name a run.
import { afterAll, afterEach, beforeEach, describe, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { text } from "../lib/maxSize.test-support";
import { paper, papersOf, started, team } from "../screening/reviewers.test-support";
import { measure, save } from "./measure.test-support";
import { tallyOfReviewer, tallyUnder } from "../screening/facets";
import * as view from "../screening/view";
import * as paperViews from "../screening/paperViews";

const SIZES = (process.env.BENCH_SIZES ?? "5000").split(",").map(Number);
/** The rows one page of Papers and of Screen's queue holds, as the pages ask for them. */
const PAGE = 50;
const QUEUE_PAGE = 25;

type Handler = { _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> };
/** A query's own handler, run in the transaction `measure` reads the metrics of, signed in as whoever `t` is. */
const call = (fn: unknown, args: Record<string, unknown>) => (ctx: unknown) => (fn as Handler)._handler(ctx, args);
const page = (options: { cursor: string | null; numItems: number }) => ({ paginationOpts: options });
const rows = (read: unknown) => `${(read as { page?: unknown[] } | null)?.page?.length ?? 0} rows`;
/** What a count said, so two runs can be checked to agree. */
const said = (read: unknown) => JSON.stringify(read, read && typeof read === "object" ? Object.keys(read).sort() : undefined);

describe("a screening with reviewers, read by its pages", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  afterAll(() => save(__filename));

  for (const size of SIZES) {
    it(`${size} papers, two people on each`, async () => {
      const made = await team(["ann", "ben"]);
      const { t, as, workspaceId } = made;
      // A plan with no limit on the papers one screening holds, so the size asked for is the size read.
      await t.run(async (ctx) => {
        const account = (await ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique())!;
        await ctx.db.patch("billingAccounts", account._id, { limits: { ...account.limits, request_papers: null } });
      });
      const { jobId } = await started(made, ["ann", "ben"], 0);
      // Its source gives the papers a step at a time, as its reading does, each with an abstract of a real one's length.
      const { checkId, sourceId } = await t.run(async (ctx) => ({
        checkId: (await ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).first())!._id,
        sourceId: (await ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", jobId)).first())!._id,
      }));
      await t.mutation(internal.screening.gathering.begin, { sourceId, pass: 0 });
      for (let from = 0; from < size; from += 200) {
        const step = Array.from({ length: Math.min(200, size - from) }, (_, n) => paper(from + n + 1, { title: `Paper ${from + n + 1}: ${text(100, from + n)}`, abstract: text(1_400, from + n) }));
        await t.mutation(internal.screening.gathering.fill, { checkId, sourceId, pass: 0, from, papers: step, read: step.length, ended: from + 200 >= size });
      }
      const ids = (await papersOf(t, jobId)).map((one) => one._id as Id<"screeningResults">);
      // Ann votes on every paper, a third each way; Ben on the first half, agreeing on most, so some are in conflict.
      const ways = ["include", "maybe", "exclude"] as const;
      const voteAll = async (who: "ann" | "ben", papers: Id<"screeningResults">[], way: (at: number) => (typeof ways)[number]) => {
        for (const decision of ways) {
          const picked = papers.filter((_, at) => way(at) === decision);
          for (let from = 0; from < picked.length; from += 100) await as[who]!.mutation(api.screening.voting.voteMany, { workspaceId, jobId, paperIds: picked.slice(from, from + 100), decision, ...(decision === "exclude" ? { reason: "other" } : {}) });
        }
      };
      await voteAll("ann", ids, (at) => ways[at % 3]!);
      await voteAll("ben", ids.slice(0, size / 2), (at) => (at % 10 === 0 ? ways[(at + 1) % 3]! : ways[at % 3]!));
      // The bookkeeping settles what the votes decide, as its worker does.
      for (let pass = 0; ; pass++) {
        const work = await t.query(internal.screening.bookkeeping.nextFinished, { name: "screening" });
        if (work.kind !== "work") break;
        if (pass > 5_000) throw new Error("The bookkeeping never ran out of papers");
        await t.mutation(internal.screening.bookkeeping.bookkeep, work.batch);
      }
      const { annRow, annReviewer } = await t.run(async (ctx) => {
        const row = (await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).find((one) => one.kind === "person")!;
        return { annRow: row.userId!, annReviewer: row._id };
      });
      // Each count as the cards and votes say it, read whole: what the counted reads must agree with.
      const truth = await t.run(async (ctx) => {
        const cards = (await ctx.db.query("screeningCards").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).filter((card) => !card.withdrawn);
        const byPaper = new Map(cards.map((card) => [card.resultId, card.result]));
        const votes = await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_at", (q) => q.eq("reviewerId", annReviewer).eq("status", "cast")).collect();
        const tally = (results: Array<string | undefined>) => said(Object.fromEntries(["include", "maybe", "exclude", "conflict", "waiting"].map((result) => [result, results.filter((one) => one === result).length])));
        return {
          source: tally(cards.filter((card) => card.sourceId === sourceId).map((card) => card.result)),
          reviewer: tally(votes.map((vote) => byPaper.get(vote.resultId))),
          include: tally(votes.filter((vote) => vote.decision === "include").map((vote) => byPaper.get(vote.resultId))),
        };
      });
      // Counts kept by a worker a moment after each change are caught up before anything is read: until they agree with
      // the cards and votes. The screening's own loops reschedule themselves for good, so the worker is given turns, not
      // run until nothing is left.
      for (let turn = 0; ; turn++) {
        vi.advanceTimersByTime(2_000);
        await t.finishInProgressScheduledFunctions();
        if (turn % 20 === 19 && (await t.run(async (ctx) => said(await tallyOfReviewer(ctx as never, annReviewer, ["include", "maybe", "exclude"])) === truth.reviewer && said(await tallyUnder(ctx as never, jobId, { source: sourceId })) === truth.source))) { console.log(`counts caught up after ${turn + 1} turns`); break; }
        if (turn > 4_000) throw new Error("The counts never caught up");
      }
      const ann = as.ann!;
      const ben = as.ben!;
      const at = (scenario: string) => ({ area: "screening team", scenario, size });
      const first = { cursor: null, numItems: PAGE };
      const job = { workspaceId, jobId };

      // The screening's own page: its header and figures, read on every tab.
      await measure(ann, at("screening header (view.get)"), call(view.get, job));
      await measure(ann, at("overview figures"), call(view.figures, { ...job, since: 0 }), (read) => JSON.stringify((read as { recent?: unknown } | null)?.recent));
      // Papers: a page of each tab, then narrowed to one reviewer, the way the reviewer chips narrow it.
      await measure(ann, at("papers, all"), call(paperViews.list, { ...job, ...page(first) }), rows);
      await measure(ann, at("papers, excluded tab"), call(paperViews.list, { ...job, result: "exclude", ...page(first) }), rows);
      await measure(ann, at("papers, in conflict tab"), call(paperViews.list, { ...job, result: "conflict", ...page(first) }), rows);
      await measure(ann, at("papers, one reviewer"), call(paperViews.list, { ...job, reviewer: annRow, ...page(first) }), rows);
      await measure(ann, at("papers, one reviewer, included tab"), call(paperViews.list, { ...job, reviewer: annRow, result: "include", ...page(first) }), rows);
      await measure(ann, at("papers, one reviewer voted exclude"), call(paperViews.list, { ...job, reviewer: annRow, voted: "exclude", ...page(first) }), rows);
      await measure(ann, at("papers, searched"), call(paperViews.list, { ...job, text: "randomized", ...page(first) }), rows);
      await measure(ann, at("papers, by title"), call(paperViews.list, { ...job, sort: "title", ...page(first) }), rows);
      // The counts beside the tabs, whole and for one reviewer.
      await measure(ann, at("tab counts, one source"), call(paperViews.counts, { ...job, source: sourceId }), said, (read) => said(read) === truth.source);
      await measure(ann, at("tab counts, one reviewer"), call(paperViews.counts, { ...job, reviewer: annRow }), said, (read) => said(read) === truth.reviewer);
      await measure(ann, at("tab counts, one reviewer voted include"), call(paperViews.counts, { ...job, reviewer: annRow, voted: "include" }), said, (read) => said(read) === truth.include);
      // Screen's queues, as Ben (half his papers still to do) and Ann (all done).
      await measure(ben, at("Screen, to do"), call(paperViews.queue, { ...job, queue: "todo", order: "dealt", ...page({ cursor: null, numItems: QUEUE_PAGE }) }), rows);
      await measure(ann, at("Screen, done"), call(paperViews.queue, { ...job, queue: "done", ...page({ cursor: null, numItems: QUEUE_PAGE }) }), rows);
      await measure(ann, at("Screen, conflicts"), call(paperViews.queue, { ...job, queue: "conflicts", ...page({ cursor: null, numItems: QUEUE_PAGE }) }), rows);
      await measure(ann, at("one paper"), call(paperViews.paper, { ...job, paperId: ids[1]! }));
      // What every page of the app reads: the rail's count, and the list of screenings.
      await measure(ben, at("rail"), call(view.rail, { workspaceId }));
      await measure(ann, at("screenings list"), call(view.list, { workspaceId, show: "all", sort: "active", ...page({ cursor: null, numItems: 20 }) }), rows);
      await measure(ann, at("screenings waiting for me"), call(view.mine, { workspaceId }), rows);
    });
  }
});
