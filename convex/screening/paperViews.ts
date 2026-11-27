/**
 * A screening's papers as someone sees them (plans/screening-reviewers): a person's queues on Screen, the table on
 * Papers, and one paper with its votes. What a reviewer may see of the other votes is decided in one place here
 * (`shown`), which every one of these reads. The files a screening exports are made in the browser from these same reads.
 */
import { paginationOptsValidator, paginationResultValidator, type PaginationResult } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { assistantQuery, defineUserQuery, userQuery, workspaceQuery } from "../lib/userActions";
import schema from "../schema";
import type { InWorkspace } from "../workspaces/actor";
import { ballotOf } from "../../lib/screening/project";
import { isFinal, leansOpen, nameHas, showsEarly, type Answer } from "../../lib/screening/rules";
import { standingOn, type Standing } from "./access";
import { askedOf, invitationsTo, reviewersOf, seesPaper, viewId, votesOf } from "./dealing";
import { placeOf } from "./settling";
import { decisionValidator, paperResultValidator, paperViewValidator, voteViewValidator } from "./validators";
import { progressRow } from "./bookkeeping";
import { keepsVotes } from "./view";

type Paper = Doc<"screeningResults">;
type Vote = Doc<"screeningVotes">;
type Reviewer = Doc<"screeningReviewers">;

/** What a reviewer is named by on a page: a person's account, a model's own row. */

type VoteView = Infer<typeof voteViewValidator>;
const paperValidator = paperViewValidator;
export type PaperView = Infer<typeof paperViewValidator>;

/** A screening as the paper reads need it: who is on it, and what the person looking is to it. */
type Looking = Standing & { reviewers: Map<Id<"screeningReviewers">, Reviewer>; first: Id<"screeningChecks"> | undefined; asked: Set<Id<"screeningResults">> };
async function lookingAt(ctx: Pick<QueryCtx, "db">, actor: InWorkspace, jobId: Id<"screeningJobs">): Promise<Looking | null> {
  const standing = await standingOn(ctx, actor, jobId);
  if (!standing || standing.job.shape !== 2 || !standing.job.rule) return null;
  const [first, reviewers, asked] = await Promise.all([ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).first(), reviewersOf(ctx, jobId), askedOf(ctx, jobId, actor.userId)]);
  return { ...standing, reviewers: new Map(reviewers.map((one) => [one._id, one])), first: first?._id, asked: new Set(asked) };
}

/** A vote as a page shows it. A model's decision follows its answers under the criteria as they are now, as the rule reads it. */
function voteOf(job: Doc<"screeningJobs">, vote: Vote, reviewer: Reviewer | undefined): VoteView | undefined {
  if (vote.status !== "cast") return undefined;
  const answers = (vote.answers ?? {}) as Record<string, Answer>;
  const read = ballotOf(placeOf(vote, reviewer), job.criteria ?? []);
  if (!read.decision) return undefined;
  return { decision: read.decision, answers, ...(read.reason ? { reason: read.reason } : {}), ...(vote.note ? { note: vote.note } : {}), at: vote.at ?? vote._creationTime, ...(vote.flagged ? { flagged: true } : {}), ...(vote.confidences ? { confidences: vote.confidences } : {}), ...(vote.passages ? { passages: vote.passages } : {}) };
}

/**
 * A paper with the votes the person looking may see. The others' votes are kept from a reviewer only while the paper
 * still waits for their own (lib/screening/rules.ts `seesVotes`): then each other reviewer is named as being on it,
 * with whether they have voted and nothing of how. Their own vote always shows, and so does a model's where the
 * models only advise the people on the paper: advice is there to be read before voting.
 */
export function shown({ job, reviewer, reviewers, first, asked }: Looking, paper: Paper, votes: Vote[]): PaperView {
  const mine = reviewer ? votes.find((vote) => vote.reviewerId === reviewer._id) : undefined;
  const result = paper.result ?? "waiting";
  const sees = seesPaper(job, paper.result, votes, (id) => reviewers.get(id)?.kind, reviewer?._id);
  const cast = votes
    .filter((vote) => vote.status !== "discarded")
    // A place closed because the paper was settled without that vote is still a place: the page says the paper was settled without it.
    .map((vote) => {
      const by = reviewers.get(vote.reviewerId);
      const own = vote.reviewerId === reviewer?._id;
      const open = sees || own || showsEarly(job.rule!, by?.kind);
      const told = open ? voteOf(job, vote, by) : undefined;
      return { reviewer: by ? viewId(by) : vote.reviewerId, ...(told ? { vote: told } : {}), ...(vote.status === "failed" ? { failed: true } : {}), ...(!open && vote.status === "cast" ? { hidden: true } : {}) };
    });
  return {
    id: paper._id,
    key: paper.paperKey,
    title: paper.title,
    authors: paper.authors,
    ...(paper.publicationYear === undefined ? {} : { year: paper.publicationYear }),
    ...(paper.venue ? { venue: paper.venue } : {}),
    ...(paper.workType ? { workType: paper.workType } : {}),
    ...(paper.citedByCount === undefined ? {} : { cited: paper.citedByCount }),
    ...(paper.doi ? { doi: paper.doi } : {}),
    abstract: paper.abstract ?? "",
    ...(!paper.abstract && paper.file ? { pdf: { ...(paper.pages === undefined ? {} : { pages: paper.pages }), ...(paper.shape === undefined ? {} : { shape: paper.shape }) } } : {}),
    ...(paper.sourceId ? { source: paper.sourceId } : {}),
    ...(paper.checkId && paper.checkId !== first ? { batch: paper.checkId, addedAt: paper._creationTime } : {}),
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
    ...(sees && asked.has(paper._id) ? { asked: true } : {}),
  };
}

/** Whether a paper's title and authors hold every word looked for. The search index finds a paper by any one of them, best match first: someone who types two words means both. */
const holdsAll = (paper: Paper, needle: string) => nameHas(paper.searchText ?? "", needle);
const views = (ctx: Pick<QueryCtx, "db">, looking: Looking, papers: Paper[]) => Promise.all(papers.map(async (paper) => shown(looking, paper, await votesOf(ctx, paper._id))));
const NONE = { page: [], isDone: true, continueCursor: "" };
const byJob = { jobId: v.id("screeningJobs") };
/** Papers one page holds at most, and rows a page looks through for the ones its filters keep. */
const PAGE_MAX = 100;
const FILTER_ROWS = 1_500;
/** A search page's cursor: the search's batch and how far into it the page got. One from before this shape starts over. */
const readCursor = (cursor: string | null): [string | null, number] => {
  try {
    const read: unknown = cursor ? JSON.parse(cursor) : null;
    return Array.isArray(read) && (read[0] === null || typeof read[0] === "string") && typeof read[1] === "number" ? [read[0], read[1]] : [null, 0];
  } catch {
    return [null, 0];
  }
};
/** Papers a page of a search reads at once to find the ones its filters keep. */
const SEARCH_SCAN = 200;

/**
 * A page of papers found by their words, kept to what `keep` says, so a page is never cut before its filters are
 * applied. It reads the search a batch at a time, by the search's own cursor; its cursor is that batch's and how far
 * into it the page got, so the next page goes on from the same paper and the search runs past any number of matches.
 */
async function searchPage<Row>(read: (options: { cursor: string | null; numItems: number }) => Promise<{ page: Paper[]; isDone: boolean; continueCursor: string }>, cursor: string | null, numItems: number, keep: (paper: Paper) => Promise<Row | null>) {
  const [batch, skip] = readCursor(cursor);
  const found = await read({ cursor: batch, numItems: SEARCH_SCAN });
  const kept = await Promise.all(found.page.slice(skip).map(keep));
  const page: Row[] = [];
  let at = 0;
  for (; at < kept.length && page.length < numItems; at++) if (kept[at] !== null) page.push(kept[at]!);
  // The batch read to its end: the next page starts the search's next batch.
  if (at === kept.length) return { page, isDone: found.isDone, continueCursor: JSON.stringify([found.continueCursor, 0]) };
  return { page, isDone: false, continueCursor: JSON.stringify([batch, skip + at]) };
}

export const paperAction = defineUserQuery({
  path: "screening/paperViews:paper",
  description: "Reads one paper of a screening the person may see: its title, authors and abstract, where it stands, and each reviewer's vote with their answers to the criteria, their reason and their note. A reviewer who has yet to vote on it sees who else is on it and not how they voted, unless the screening shows votes at any time. Where the models only advise, their votes show before the reviewer votes.",
  args: { ...byJob, paperId: v.id("screeningResults") },
  returns: v.union(paperValidator, v.null()),
  run: async (ctx, actor, { jobId, paperId }) => {
    const looking = await lookingAt(ctx, actor, jobId);
    const paper = looking ? await ctx.db.get("screeningResults", paperId) : null;
    return looking && paper?.jobId === jobId ? shown(looking, paper, await votesOf(ctx, paperId)) : null;
  },
});
export const paper = userQuery(paperAction);
export const paperForAssistant = assistantQuery(paperAction);

/** Where a paper's own PDF is read from, for whoever may see the paper: what one with no abstract is screened on. The file is its adder's, and is given to this screening's people only. */
export const pdf = workspaceQuery({
  args: { ...byJob, paperId: v.id("screeningResults") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, actor, { jobId, paperId }) => {
    const looking = await lookingAt(ctx, actor, jobId);
    const paper = looking ? await ctx.db.get("screeningResults", paperId) : null;
    return paper?.jobId === jobId && paper.file ? await ctx.storage.getUrl(paper.file) : null;
  },
});

/** Papers one count looks through: more than any plan gives one screening. Past it, no count is given. */
const COUNTED = 8_192;

/**
 * How many of a screening's papers stand each way under what the Papers page is narrowed to: a source, a check, a
 * reason, or the papers one reviewer is on or voted one way. Counted from the papers' cards (./cards.ts) in one read,
 * so the page's tabs say how many each holds before any is opened. Null where it can't be said: the papers someone
 * else voted one way, for a person from whom votes are still kept.
 */
export const counts = workspaceQuery({
  args: {
    ...byJob,
    source: v.optional(v.id("screeningSources")),
    check: v.optional(v.union(v.id("screeningChecks"), v.literal("start"))),
    reason: v.optional(v.string()),
    reviewer: v.optional(v.string()),
    voted: v.optional(v.union(decisionValidator, v.literal("none"), v.literal("failed"))),
  },
  returns: v.union(v.null(), v.object({ include: v.number(), maybe: v.number(), exclude: v.number(), conflict: v.number(), waiting: v.number() })),
  handler: async (ctx, actor, { jobId, source, check: asked, reason, reviewer, voted }) => {
    const looking = await lookingAt(ctx, actor, jobId);
    if (!looking) return null;
    const check = asked === "start" ? looking.first : asked;
    if (asked === "start" && !check) return null;
    const keeps = (card: Doc<"screeningCards">) => !card.withdrawn && (!source || card.sourceId === source) && (!check || card.checkId === check) && (!reason || (card.result === "exclude" && (card.reason ?? "other") === reason));
    const tally = { include: 0, maybe: 0, exclude: 0, conflict: 0, waiting: 0 };
    const cards = await ctx.db.query("screeningCards").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(COUNTED + 1);
    if (cards.length > COUNTED) return null;
    if (!reviewer) {
      for (const card of cards) if (keeps(card)) tally[card.result]++;
      return tally;
    }
    const row = [...looking.reviewers.values()].find((one) => viewId(one) === reviewer || one._id === reviewer);
    if (!row) return null;
    // Which way someone else voted is kept from a reviewer who still has papers to vote on (./view.ts `keepsVotes`): so is how many they voted each way.
    const others = voted && voted !== "none" && voted !== "failed" && row._id !== looking.reviewer?._id;
    if (others && !showsEarly(looking.job.rule!, row.kind) && keepsVotes(looking.job, looking.reviewer, (await progressRow(ctx as QueryCtx, jobId))?.reviewers, looking.reviewers.values(), (await invitationsTo(ctx, jobId)).length)) return null;
    const votes = ctx.db.query("screeningVotes");
    const theirs = await (voted === "none" || voted === "failed"
      ? votes.withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", row._id).eq("status", voted === "none" ? "waiting" : "failed"))
      : voted
        ? votes.withIndex("by_reviewer_and_status_and_decision_and_at", (q) => q.eq("reviewerId", row._id).eq("status", "cast").eq("decision", voted))
        : votes.withIndex("by_reviewer_and_status_and_at", (q) => q.eq("reviewerId", row._id).eq("status", "cast"))
    ).take(COUNTED + 1);
    if (theirs.length > COUNTED) return null;
    // Their votes are matched to the screening's cards here: two reads, however many papers they voted on.
    const cardOf = new Map(cards.map((card) => [card.resultId, card]));
    for (const vote of theirs) { const card = cardOf.get(vote.resultId); if (card && keeps(card)) tally[card.result]++; }
    return tally;
  },
});

/** Pages a reviewer's rows of votes into the papers they are on, in the rows' order. */
async function papersOfVotes(ctx: Pick<QueryCtx, "db">, looking: Looking, read: PaginationResult<Vote>) {
  // A paper whose source was taken out is in no queue, though the votes on it are kept.
  const papers = (await Promise.all(read.page.map((vote) => ctx.db.get("screeningResults", vote.resultId)))).filter((one): one is Paper => one !== null && !one.withdrawn);
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
    // A finished screening takes no vote, so nothing is to do in it: the queue is as empty as its count says (./dealing.ts `waitsOn`).
    const todo = job.finishedAt === undefined;
    if (needle) {
      // Found by its words, best match first, then kept to the queue.
      const mine = (row: PaperView) => row.cast.find((one) => one.reviewer === actor.userId);
      const inQueue = (row: PaperView) => (queue === "conflicts" ? true : queue === "todo" ? todo && row.mine && !mine(row)?.vote && !isFinal(row.result) : queue === "again" ? mine(row)?.vote?.flagged === true : mine(row)?.vote !== undefined && (!voted || mine(row)!.vote!.decision === voted));
      return await searchPage((page) => ctx.db.query("screeningResults").withSearchIndex("search_papers", (q) => (queue === "conflicts" ? q.search("searchText", needle).eq("jobId", jobId).eq("result", "conflict") : q.search("searchText", needle).eq("jobId", jobId))).paginate(page), paginationOpts.cursor, options.numItems, async (paper) => {
        // A paper whose source was taken out is in no queue, found by its words or not.
        if (paper.withdrawn || !holdsAll(paper, needle)) return null;
        const [row] = await views(ctx, looking, [paper]);
        return row && inQueue(row) ? row : null;
      });
    }
    if (queue === "conflicts") {
      const read = await ctx.db.query("screeningResults").withIndex("by_job_and_result", (q) => q.eq("jobId", jobId).eq("result", "conflict")).paginate(options);
      return { ...read, page: await views(ctx, looking, read.page) };
    }
    if (!reviewer || (queue === "todo" && !todo)) return NONE;
    const votes = ctx.db.query("screeningVotes");
    // Where votes are hidden until the person votes, an order by the models' votes would give them away, unless the models only advise: then their votes show anyway.
    const lean = order === "lean" && leansOpen(job.rule!);
    const read =
      queue === "todo"
        ? await (lean ? votes.withIndex("by_reviewer_and_status_and_lean_and_place", (q) => q.eq("reviewerId", reviewer._id).eq("status", "waiting")) : votes.withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", reviewer._id).eq("status", "waiting"))).order(order === "fresh" ? "desc" : "asc").paginate(options)
        : queue === "again"
          ? await votes.withIndex("by_reviewer_and_flagged_and_place", (q) => q.eq("reviewerId", reviewer._id).eq("flagged", true)).paginate(options)
          : await (voted ? votes.withIndex("by_reviewer_and_status_and_decision_and_at", (q) => q.eq("reviewerId", reviewer._id).eq("status", "cast").eq("decision", voted)) : votes.withIndex("by_reviewer_and_status_and_at", (q) => q.eq("reviewerId", reviewer._id).eq("status", "cast"))).order("desc").paginate(options);
    return await papersOfVotes(ctx, looking, read);
  },
});
export const queue = userQuery(queueAction);
export const queueForAssistant = assistantQuery(queueAction);

const SORTS = v.union(v.literal("added"), v.literal("title"), v.literal("title-desc"), v.literal("result"), v.literal("newest"), v.literal("split"), v.literal("points"));

export const listAction = defineUserQuery({
  path: "screening/paperViews:list",
  description:
    "Lists a screening's papers, a page at a time, each with where it stands and its reviewers' votes as the person may see them. Kept to one result (`result`: include, maybe, exclude, conflict or waiting), one source, the papers one check of the sources brought (`check`, or `start` for the ones it started with), one reason for excluding, " +
    "the papers a reviewer is on (`reviewer`, a person's ID or a model's row), with `voted` the ones they voted one way (include, maybe, exclude), have yet to vote on (`none`), a model couldn't read (`failed`) or, for a person, settled themselves whatever the votes said (`settled`), and with `also` the ones those other reviewers voted on too. `text` keeps the papers whose title or authors match. " +
    "In the order they were added, by title either way, grouped by result, newest published first, most divided first (`split`) or most points first.",
  args: {
    ...byJob,
    result: v.optional(paperResultValidator),
    source: v.optional(v.id("screeningSources")),
    check: v.optional(v.union(v.id("screeningChecks"), v.literal("start"))),
    reason: v.optional(v.string()),
    reviewer: v.optional(v.string()),
    voted: v.optional(v.union(decisionValidator, v.literal("none"), v.literal("failed"), v.literal("settled"))),
    also: v.optional(v.array(v.string())),
    text: v.optional(v.string()),
    sort: v.optional(SORTS),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(paperValidator),
  run: async (ctx, actor, { jobId, result, source, check: asked, reason, reviewer, voted, also, text, sort: asked_sort = "added", paginationOpts }) => {
    const looking = await lookingAt(ctx, actor, jobId);
    if (!looking) return NONE;
    // The papers it started with are the ones its first look in its sources brought.
    const check = asked === "start" ? looking.first : asked;
    if (asked === "start" && !check) return NONE;
    const options = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PAGE_MAX) };
    // While the others' votes are kept from the person (./view.ts `keepsVotes`), nothing worked out from those votes orders or narrows what they are given.
    const kept = keepsVotes(looking.job, looking.reviewer, (await progressRow(ctx as QueryCtx, jobId))?.reviewers, looking.reviewers.values(), (await invitationsTo(ctx, jobId)).length);
    // How divided a paper's votes are, and the points their answers give it, put the papers in an order that says how the others voted: asked for then, the papers come as they were added.
    const sort = kept && (asked_sort === "split" || asked_sort === "points") ? "added" : asked_sort;
    const rowOf = (id: string) => [...looking.reviewers.values()].find((one) => viewId(one) === id || one._id === id);
    const others = (also ?? []).flatMap((id) => rowOf(id)?._id ?? []);
    const keeps = (paper: Paper) => !paper.withdrawn && (!result || (paper.result ?? "waiting") === result) && (!source || paper.sourceId === source) && (!check || paper.checkId === check) && (!reason || (paper.result === "exclude" && (paper.reason ?? "other") === reason));
    // The papers every one of those reviewers voted on.
    const shared = async (paperId: Id<"screeningResults">) => !others.length || others.every((id) => castOn.get(paperId)?.has(id));
    const castOn = new Map<Id<"screeningResults">, Set<Id<"screeningReviewers">>>();
    const withVotes = async (papers: Paper[]) => {
      const rows = await Promise.all(papers.map(async (paper) => ({ paper, votes: await votesOf(ctx, paper._id) })));
      for (const { paper, votes } of rows) castOn.set(paper._id, new Set(votes.filter((vote) => vote.status === "cast").map((vote) => vote.reviewerId)));
      const kept: PaperView[] = [];
      for (const { paper, votes } of rows) if (await shared(paper._id)) kept.push(shown(looking, paper, votes));
      return kept;
    };
    const needle = text?.trim() ?? "";
    if (needle) {
      // Found by its words and still kept to the reviewer and the vote asked for, by what the person may see of them: a vote kept from them is no match for any way of voting.
      const of = reviewer ? rowOf(reviewer) : undefined;
      const settler = reviewer && voted === "settled" ? ctx.db.normalizeId("users", reviewer) : null;
      if (reviewer && (voted === "settled" ? !settler : !of)) return NONE;
      const place = (paper: PaperView) => (of ? paper.cast.find((one) => one.reviewer === viewId(of)) : undefined);
      const theirs = (paper: PaperView) => {
        if (!of || voted === "settled") return true;
        const on = place(paper);
        if (!on) return false;
        return voted === "none" ? !on.vote && !on.hidden && !on.failed : voted === "failed" ? on.failed === true : voted ? on.vote?.decision === voted : on.vote !== undefined || on.hidden === true;
      };
      return await searchPage((page) => ctx.db.query("screeningResults").withSearchIndex("search_papers", (q) => { const found = q.search("searchText", needle).eq("jobId", jobId); const of = result ? found.eq("result", result) : found; return source ? of.eq("sourceId", source) : of; }).paginate(page), paginationOpts.cursor, options.numItems, async (paper) => {
        if (!keeps(paper) || !holdsAll(paper, needle) || (settler && paper.resolved?.by !== settler)) return null;
        const [row] = await withVotes([paper]);
        return row && theirs(row) ? row : null;
      });
    }
    const papers = stream(ctx.db, schema).query("screeningResults");
    // The conflicts one person settled: by whoever settled them, who needn't be one of its reviewers.
    if (reviewer && voted === "settled") {
      const settler = ctx.db.normalizeId("users", reviewer);
      if (!settler) return NONE;
      const read = await papers.withIndex("by_job_and_resolver", (q) => q.eq("jobId", jobId).eq("resolved.by", settler)).filterWith(async (paper) => keeps(paper)).paginate({ ...options, maximumRowsRead: FILTER_ROWS });
      return { ...read, page: await withVotes(read.page) };
    }
    const row = reviewer ? rowOf(reviewer) : undefined;
    if (reviewer && !row) return NONE;
    if (row) {
      // One reviewer's papers, in the order of their votes: what they are on, or the ones they voted one way.
      const votes = stream(ctx.db, schema).query("screeningVotes");
      // Which way someone else voted on a paper whose votes are kept from the person looking is kept from them here too. Their votes are then read whichever way they went, every one of them, and the way is looked at only on a paper whose votes show: what a page holds, where it ends and whether another follows depend on how many votes they cast, which shows anyway, and never on a vote that is kept.
      const told = kept && voted && voted !== "none" && voted !== "failed" && row._id !== looking.reviewer?._id && !showsEarly(looking.job.rule!, row.kind);
      const mine = looking.reviewer?._id;
      const open = async (vote: Doc<"screeningVotes">) => !told || (vote.decision === voted && (!mine || !(await votesOf(ctx, vote.resultId)).some((one) => one.reviewerId === mine && one.status === "waiting")));
      const read = await (voted === "none" || voted === "failed"
        ? votes.withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", row._id).eq("status", voted === "none" ? "waiting" : "failed"))
        : voted && voted !== "settled" && !told
          ? votes.withIndex("by_reviewer_and_status_and_decision_and_at", (q) => q.eq("reviewerId", row._id).eq("status", "cast").eq("decision", voted))
          : votes.withIndex("by_reviewer_and_status_and_at", (q) => q.eq("reviewerId", row._id).eq("status", "cast"))
        // The paper's own filters (a result, a source, a reason) are asked of each vote before the page is cut, so a page is never empty while papers that match lie further on.
      ).filterWith(async (vote) => {
        if (!(await open(vote))) return false;
        const paper = await ctx.db.get("screeningResults", vote.resultId);
        if (!paper || !keeps(paper)) return false;
        // The papers every one of the reviewers compared with them voted on too (an agreement cell's list), asked here as well.
        if (!others.length) return true;
        const cast = new Set((await votesOf(ctx, paper._id)).filter((one) => one.status === "cast").map((one) => one.reviewerId));
        return others.every((id) => cast.has(id));
      }).paginate({ ...options, maximumRowsRead: FILTER_ROWS });
      // A model's decision is kept on its row as the worker last read it; the page shows it as it reads now.
      const theirs = (await Promise.all(read.page.map((vote) => ctx.db.get("screeningResults", vote.resultId)))).filter((one): one is Paper => one !== null && keeps(one));
      return { ...read, page: (await withVotes(theirs)).filter((paper) => !told || paper.sees) };
    }
    const field = { title: "title", "title-desc": "title", newest: "publicationYear", split: "split", points: "score" } as const;
    const down = sort === "title-desc" || sort === "newest" || sort === "split" || sort === "points";
    // The one filter an index takes with each order, most telling first; whatever else was asked for is kept in passing.
    const read = await (
      // Grouped by where they stand, in the order the index keeps the results in: one result alone is in the order its papers were added.
      sort === "result"
        ? result
          ? papers.withIndex("by_job_and_result", (q) => q.eq("jobId", jobId).eq("result", result))
          : papers.withIndex("by_job_and_result", (q) => q.eq("jobId", jobId))
        : sort === "added"
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
export const listForAssistant = assistantQuery(listAction);
