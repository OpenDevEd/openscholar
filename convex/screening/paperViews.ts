/**
 * A screening's papers as someone sees them (plans/screening-reviewers): a person's queues on Screen, the table on
 * Papers, and one paper with its votes. What a reviewer may see of the other votes is decided in one place here
 * (`shown`), which every one of these reads, and the files a screening exports read it too (./exporting.ts).
 */
import { paginationOptsValidator, paginationResultValidator, type PaginationResult } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { defineUserQuery, userQuery } from "../lib/userActions";
import schema from "../schema";
import type { InWorkspace } from "../workspaces/actor";
import { decide, isFinal, seesVotes, type Answer } from "../../lib/screening/rules";
import { standingOn, type Standing } from "./access";
import { reviewersOf } from "./dealing";
import { decisionValidator, paperResultValidator, screeningAuthorsValidator, voteAnswersValidator, votePassagesValidator } from "./validators";

type Paper = Doc<"screeningResults">;
type Vote = Doc<"screeningVotes">;
type Reviewer = Doc<"screeningReviewers">;

/** What a reviewer is named by on a page: a person's account, a model's own row. */
const viewId = (reviewer: Reviewer) => (reviewer.kind === "person" && reviewer.userId ? reviewer.userId : reviewer._id);

const voteValidator = v.object({
  decision: decisionValidator,
  answers: voteAnswersValidator,
  reason: v.optional(v.string()),
  note: v.optional(v.string()),
  at: v.number(),
  flagged: v.optional(v.boolean()),
  confidences: v.optional(v.record(v.string(), v.number())),
  passages: v.optional(votePassagesValidator),
});

/** One reviewer's place on a paper: their vote where the person looking may see it, that a model couldn't read the paper, or only that they are on it. */
const castValidator = v.object({ reviewer: v.string(), vote: v.optional(voteValidator), failed: v.optional(v.boolean()), hidden: v.optional(v.boolean()) });

const paperValidator = v.object({
  id: v.id("screeningResults"),
  key: v.string(),
  title: v.string(),
  authors: screeningAuthorsValidator,
  year: v.optional(v.number()),
  venue: v.optional(v.string()),
  cited: v.optional(v.number()),
  doi: v.optional(v.string()),
  abstract: v.string(),
  source: v.optional(v.id("screeningSources")),
  batch: v.optional(v.id("screeningChecks")),
  place: v.number(),
  result: paperResultValidator,
  reason: v.optional(v.string()),
  points: v.optional(v.number()),
  stars: v.optional(v.number()),
  // A person settled it, whatever its votes say.
  resolved: v.optional(v.object({ by: v.id("users"), note: v.optional(v.string()), reason: v.optional(v.string()), at: v.number() })),
  // Whether the person looking sees the other votes on it, and what was written about it.
  sees: v.boolean(),
  cast: v.array(castValidator),
  // Whether the paper is theirs to vote on, and their own vote.
  mine: v.boolean(),
  messages: v.number(),
});
export type PaperView = Infer<typeof paperValidator>;

/** A screening as the paper reads need it: who is on it, and what the person looking is to it. */
type Looking = Standing & { reviewers: Map<Id<"screeningReviewers">, Reviewer>; first: Id<"screeningChecks"> | undefined };
async function lookingAt(ctx: Pick<QueryCtx, "db">, actor: InWorkspace, jobId: Id<"screeningJobs">): Promise<Looking | null> {
  const standing = await standingOn(ctx, actor, jobId);
  if (!standing || standing.job.shape !== 2 || !standing.job.rule) return null;
  const first = await ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).first();
  return { ...standing, reviewers: new Map((await reviewersOf(ctx, jobId)).map((one) => [one._id, one])), first: first?._id };
}

/** A vote as a page shows it. A model's decision follows its answers under the criteria as they are now, as the rule reads it. */
function voteOf(job: Doc<"screeningJobs">, vote: Vote, reviewer: Reviewer | undefined): Infer<typeof voteValidator> | undefined {
  if (vote.status !== "cast" || !vote.decision) return undefined;
  const answers = (vote.answers ?? {}) as Record<string, Answer>;
  const read = reviewer?.kind === "model" ? decide(answers, job.criteria ?? []) : { decision: vote.decision, reason: vote.reason };
  return { decision: read.decision, answers, ...(read.reason ? { reason: read.reason } : {}), ...(vote.note ? { note: vote.note } : {}), at: vote.at ?? vote._creationTime, ...(vote.flagged ? { flagged: true } : {}), ...(vote.confidences ? { confidences: vote.confidences } : {}), ...(vote.passages ? { passages: vote.passages } : {}) };
}

/**
 * A paper with the votes the person looking may see. The others' votes are kept from a reviewer only while the paper
 * still waits for their own (lib/screening/rules.ts `seesVotes`): then each other reviewer is named as being on it,
 * and nothing of their vote is told. Their own vote always shows.
 */
export function shown({ job, reviewer, reviewers, first }: Looking, paper: Paper, votes: Vote[]): PaperView {
  const mine = reviewer ? votes.find((vote) => vote.reviewerId === reviewer._id) : undefined;
  const result = paper.result ?? "waiting";
  const sees = seesVotes(job.rule!.blind, result, mine?.status === "waiting" ? "waiting" : undefined);
  const cast = votes
    .filter((vote) => vote.status !== "discarded")
    // A place closed because the paper was settled without that vote is still a place: the page says the paper was settled without it.
    .map((vote) => {
      const by = reviewers.get(vote.reviewerId);
      const own = vote.reviewerId === reviewer?._id;
      const told = sees || own ? voteOf(job, vote, by) : undefined;
      return { reviewer: by ? viewId(by) : vote.reviewerId, ...(told ? { vote: told } : {}), ...((sees || own) && vote.status === "failed" ? { failed: true } : {}), ...(!sees && !own ? { hidden: true } : {}) };
    });
  return {
    id: paper._id,
    key: paper.paperKey,
    title: paper.title,
    authors: paper.authors,
    ...(paper.publicationYear === undefined ? {} : { year: paper.publicationYear }),
    ...(paper.venue ? { venue: paper.venue } : {}),
    ...(paper.citedByCount === undefined ? {} : { cited: paper.citedByCount }),
    ...(paper.doi ? { doi: paper.doi } : {}),
    abstract: paper.abstract ?? "",
    ...(paper.sourceId ? { source: paper.sourceId } : {}),
    ...(paper.checkId && paper.checkId !== first ? { batch: paper.checkId } : {}),
    place: paper.place ?? 0,
    result,
    ...(sees && paper.reason ? { reason: paper.reason } : {}),
    ...(sees && paper.score !== undefined ? { points: paper.score } : {}),
    ...(sees && paper.stars !== undefined ? { stars: paper.stars } : {}),
    ...(paper.resolved ? { resolved: { by: paper.resolved.by, at: paper.resolved.at, ...(paper.resolved.note ? { note: paper.resolved.note } : {}), ...(paper.resolved.reason ? { reason: paper.resolved.reason } : {}) } } : {}),
    sees,
    cast,
    mine: mine !== undefined && mine.status !== "closed" && mine.status !== "discarded",
    messages: sees ? (paper.messages ?? 0) : 0,
  };
}

const votesOn = (ctx: Pick<QueryCtx, "db">, paperId: Id<"screeningResults">) => ctx.db.query("screeningVotes").withIndex("by_result", (q) => q.eq("resultId", paperId)).take(500);
const views = (ctx: Pick<QueryCtx, "db">, looking: Looking, papers: Paper[]) => Promise.all(papers.map(async (paper) => shown(looking, paper, await votesOn(ctx, paper._id))));
const NONE = { page: [], isDone: true, continueCursor: "" };
const byJob = { jobId: v.id("screeningJobs") };
/** Papers one page holds at most, and rows a page looks through for the ones its filters keep. */
const PAGE_MAX = 100;
const FILTER_ROWS = 1_500;

export const paperAction = defineUserQuery({
  path: "screening/paperViews:paper",
  description: "Reads one paper of a screening the person may see: its title, authors and abstract, where it stands, and each reviewer's vote with their answers to the criteria, their reason and their note. A reviewer who has yet to vote on it sees who else is on it and not how they voted, unless the screening shows votes at any time.",
  args: { ...byJob, paperId: v.id("screeningResults") },
  returns: v.union(paperValidator, v.null()),
  run: async (ctx, actor, { jobId, paperId }) => {
    const looking = await lookingAt(ctx, actor, jobId);
    const paper = looking ? await ctx.db.get("screeningResults", paperId) : null;
    return looking && paper?.jobId === jobId ? shown(looking, paper, await votesOn(ctx, paperId)) : null;
  },
});
export const paper = userQuery(paperAction);

/** Pages a reviewer's rows of votes into the papers they are on, in the rows' order. */
async function papersOfVotes(ctx: Pick<QueryCtx, "db">, looking: Looking, read: PaginationResult<Vote>) {
  const papers = (await Promise.all(read.page.map((vote) => ctx.db.get("screeningResults", vote.resultId)))).filter((one): one is Paper => one !== null);
  return { ...read, page: await views(ctx, looking, papers) };
}

export const queueAction = defineUserQuery({
  path: "screening/paperViews:queue",
  description:
    "Lists one of the person's queues on a screening, a page at a time: `todo`, the papers that wait for their vote, in the order they were given (`dealt`), the latest arrivals first (`fresh`) or the ones its models would include first (`lean`); `again`, their votes cast before a criterion became a must-have, which ask for a new one; " +
    "`done`, the papers they voted on, the latest first, all of them or the ones they voted one way (`voted`); and `conflicts`, the papers its reviewers split on. `text` keeps the papers whose title or authors match.",
  args: { ...byJob, queue: v.union(v.literal("todo"), v.literal("again"), v.literal("done"), v.literal("conflicts")), order: v.optional(v.union(v.literal("dealt"), v.literal("fresh"), v.literal("lean"))), voted: v.optional(decisionValidator), text: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(paperValidator),
  run: async (ctx, actor, { jobId, queue, order = "dealt", voted, text, paginationOpts }) => {
    const looking = await lookingAt(ctx, actor, jobId);
    if (!looking) return NONE;
    const { job, reviewer } = looking;
    const options = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PAGE_MAX) };
    const needle = text?.trim() ?? "";
    if (needle) {
      // Found by its words, best match first, then kept to the queue.
      const read = await ctx.db.query("screeningResults").withSearchIndex("search_papers", (q) => (queue === "conflicts" ? q.search("searchText", needle).eq("jobId", jobId).eq("result", "conflict") : q.search("searchText", needle).eq("jobId", jobId))).paginate(options);
      const rows = await views(ctx, looking, read.page);
      const mine = (row: PaperView) => row.cast.find((one) => one.reviewer === actor.userId);
      return { ...read, page: rows.filter((row) => (queue === "conflicts" ? true : queue === "todo" ? row.mine && !mine(row)?.vote && !isFinal(row.result) : queue === "again" ? mine(row)?.vote?.flagged === true : mine(row)?.vote !== undefined && (!voted || mine(row)!.vote!.decision === voted))) };
    }
    if (queue === "conflicts") {
      const read = await ctx.db.query("screeningResults").withIndex("by_job_and_result", (q) => q.eq("jobId", jobId).eq("result", "conflict")).paginate(options);
      return { ...read, page: await views(ctx, looking, read.page) };
    }
    if (!reviewer) return NONE;
    const votes = ctx.db.query("screeningVotes");
    // Where votes are hidden until the person votes, an order by the models' votes would give them away.
    const lean = order === "lean" && job.rule!.blind === "always";
    const read =
      queue === "todo"
        ? await (lean ? votes.withIndex("by_reviewer_and_status_and_lean_and_place", (q) => q.eq("reviewerId", reviewer._id).eq("status", "waiting")) : votes.withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", reviewer._id).eq("status", "waiting"))).order(order === "fresh" ? "desc" : "asc").paginate(options)
        : queue === "again"
          ? await votes.withIndex("by_reviewer_and_flagged_and_place", (q) => q.eq("reviewerId", reviewer._id).eq("flagged", true)).paginate(options)
          : await (voted ? votes.withIndex("by_reviewer_and_decision_and_at", (q) => q.eq("reviewerId", reviewer._id).eq("decision", voted)) : votes.withIndex("by_reviewer_and_status_and_at", (q) => q.eq("reviewerId", reviewer._id).eq("status", "cast"))).order("desc").paginate(options);
    return await papersOfVotes(ctx, looking, read);
  },
});
export const queue = userQuery(queueAction);

const SORTS = v.union(v.literal("added"), v.literal("title"), v.literal("newest"), v.literal("split"), v.literal("points"));

export const listAction = defineUserQuery({
  path: "screening/paperViews:list",
  description:
    "Lists a screening's papers, a page at a time, each with where it stands and its reviewers' votes as the person may see them. Kept to one result (`result`: include, maybe, exclude, conflict or waiting), one source, the papers one check of the sources brought (`check`), one reason for excluding, " +
    "the papers a reviewer is on (`reviewer`, a person's ID or a model's row), with `voted` the ones they voted one way (include, maybe, exclude), have yet to vote on (`none`) or a model couldn't read (`failed`), and with `also` the ones those other reviewers voted on too. `text` keeps the papers whose title or authors match. " +
    "In the order they were added, by title, newest published first, most divided first (`split`) or most points first.",
  args: {
    ...byJob,
    result: v.optional(paperResultValidator),
    source: v.optional(v.id("screeningSources")),
    check: v.optional(v.id("screeningChecks")),
    reason: v.optional(v.string()),
    reviewer: v.optional(v.string()),
    voted: v.optional(v.union(decisionValidator, v.literal("none"), v.literal("failed"))),
    also: v.optional(v.array(v.string())),
    text: v.optional(v.string()),
    sort: v.optional(SORTS),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(paperValidator),
  run: async (ctx, actor, { jobId, result, source, check, reason, reviewer, voted, also, text, sort = "added", paginationOpts }) => {
    const looking = await lookingAt(ctx, actor, jobId);
    if (!looking) return NONE;
    const options = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PAGE_MAX) };
    const rowOf = (id: string) => [...looking.reviewers.values()].find((one) => viewId(one) === id || one._id === id);
    const others = (also ?? []).flatMap((id) => rowOf(id)?._id ?? []);
    const keeps = (paper: Paper) => (!result || (paper.result ?? "waiting") === result) && (!source || paper.sourceId === source) && (!check || paper.checkId === check) && (!reason || (paper.result === "exclude" && (paper.reason ?? "other") === reason));
    // The papers every one of those reviewers voted on.
    const shared = async (paperId: Id<"screeningResults">) => !others.length || others.every((id) => castOn.get(paperId)?.has(id));
    const castOn = new Map<Id<"screeningResults">, Set<Id<"screeningReviewers">>>();
    const withVotes = async (papers: Paper[]) => {
      const rows = await Promise.all(papers.map(async (paper) => ({ paper, votes: await votesOn(ctx, paper._id) })));
      for (const { paper, votes } of rows) castOn.set(paper._id, new Set(votes.filter((vote) => vote.status === "cast").map((vote) => vote.reviewerId)));
      const kept: PaperView[] = [];
      for (const { paper, votes } of rows) if (await shared(paper._id)) kept.push(shown(looking, paper, votes));
      return kept;
    };
    const needle = text?.trim() ?? "";
    if (needle) {
      const read = await ctx.db.query("screeningResults").withSearchIndex("search_papers", (q) => { const found = q.search("searchText", needle).eq("jobId", jobId); const of = result ? found.eq("result", result) : found; return source ? of.eq("sourceId", source) : of; }).paginate(options);
      return { ...read, page: await withVotes(read.page.filter(keeps)) };
    }
    const row = reviewer ? rowOf(reviewer) : undefined;
    if (reviewer && !row) return NONE;
    if (row) {
      // One reviewer's papers, in the order of their votes: what they are on, or the ones they voted one way.
      const votes = ctx.db.query("screeningVotes");
      const read = await (voted === "none" || voted === "failed"
        ? votes.withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", row._id).eq("status", voted === "none" ? "waiting" : "failed"))
        : voted
          ? votes.withIndex("by_reviewer_and_decision_and_at", (q) => q.eq("reviewerId", row._id).eq("decision", voted))
          : votes.withIndex("by_reviewer_and_status_and_at", (q) => q.eq("reviewerId", row._id).eq("status", "cast"))
      ).paginate(options);
      // A model's decision is kept on its row as the worker last read it; the page shows it as it reads now.
      const papers = (await Promise.all(read.page.map((vote) => ctx.db.get("screeningResults", vote.resultId)))).filter((one): one is Paper => one !== null && keeps(one));
      return { ...read, page: await withVotes(papers) };
    }
    const papers = stream(ctx.db, schema).query("screeningResults");
    const field = { title: "title", newest: "publicationYear", split: "split", points: "score" } as const;
    const down = sort === "newest" || sort === "split" || sort === "points";
    // The one filter an index takes with each order, most telling first; whatever else was asked for is kept in passing.
    const read = await (
      sort === "added"
        ? reason
          ? papers.withIndex("by_job_and_reason", (q) => q.eq("jobId", jobId).eq("reason", reason))
          : check
            ? papers.withIndex("by_job_and_check", (q) => q.eq("jobId", jobId).eq("checkId", check))
            : source
              ? papers.withIndex("by_job_and_source", (q) => q.eq("jobId", jobId).eq("sourceId", source))
              : result
                ? papers.withIndex("by_job_and_result", (q) => q.eq("jobId", jobId).eq("result", result))
                : papers.withIndex("by_job", (q) => q.eq("jobId", jobId))
        : result
          ? papers.withIndex(`by_job_and_result_and_${field[sort]}`, (q) => q.eq("jobId", jobId).eq("result", result))
          : papers.withIndex(`by_job_and_${field[sort]}`, (q) => q.eq("jobId", jobId))
    )
      .order(down ? "desc" : "asc")
      .filterWith(async (paper) => keeps(paper))
      .paginate({ ...options, maximumRowsRead: FILTER_ROWS });
    return { ...read, page: await withVotes(read.page) };
  },
});
export const list = userQuery(listAction);
