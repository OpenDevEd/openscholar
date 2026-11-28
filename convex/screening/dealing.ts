/**
 * Who a screening's papers go to (plans/screening-reviewers). A paper is given to its reviewers as a row each in
 * `screeningVotes`: so many of the people, taken in turn, and every model. This is the one place rows are made
 * for a paper, when it arrives and whenever the people, the models or the rule change.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { personName } from "../lib/people";
import { stripProviderPrefix } from "../../lib/ai/model-display";
import { project } from "../../lib/screening/project";
import { SOMEONE, advisory, gotThrough, nextResolver, seesVotes, theirsOf } from "../../lib/screening/rules";
import { actorIn } from "../workspaces/actor";
import { readsPdfs } from "../../lib/assistant/files";
import { readsPdfOf } from "../../lib/pricing/estimate";
import { MAX_REVIEWERS, MAX_SOURCE_ROWS } from "./validators";
import { tallyOfReviewer } from "./facets";

type Reviewer = Doc<"screeningReviewers">;

export { MAX_REVIEWERS, MAX_SOURCE_ROWS };

/** Everyone's place on one paper. */
export const votesOf = (ctx: Pick<QueryCtx, "db">, resultId: Id<"screeningResults">) => ctx.db.query("screeningVotes").withIndex("by_result", (q) => q.eq("resultId", resultId)).take(MAX_REVIEWERS);
/** A screening's sources in the order they were added, the ones taken out included. */
export const sourcesOf = (ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">) => ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(MAX_SOURCE_ROWS);

/**
 * Votes one transaction writes at most where it works through papers a step at a time: each paper has a row for
 * every reviewer on it, each row written is read back twice for its trigger (./facets.ts), and settling may write a
 * row twice (closed, then counted), against a transaction's 4,096 index ranges. Measured on settling papers of thirty
 * reviewers each under "settled by the first vote" (convex/limits/maxSizeScreening.test.ts): 1,000 passed the limit,
 * 800 didn't; 400 leaves room. A step takes as many papers as that leaves room for, at least one.
 */
export const VOTE_WRITES = 400;
export const papersAStep = (reviewers: number, most: number) => Math.max(1, Math.min(most, Math.floor(VOTE_WRITES / Math.max(1, reviewers))));

/** A screening's reviewers in the order they were added, whoever has left included. */
export const reviewersOf = (ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">) => ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(MAX_REVIEWERS);

/** What names a reviewer on a page: a person their account, a model its row. */
export const viewId = (reviewer: Reviewer) => (reviewer.kind === "person" && reviewer.userId ? reviewer.userId : reviewer._id);

/** The people papers are dealt to: on the screening, with an account. Someone invited by email is dealt none until they join. */
export const dealable = (reviewer: Reviewer) => reviewer.kind === "person" && reviewer.userId !== undefined && reviewer.left === undefined;
export const readingModel = (reviewer: Reviewer) => reviewer.kind === "model" && reviewer.left === undefined;

/** Who papers go to: the people they are dealt to, in the order they joined, and the models that read (lib/screening/project.ts). */
export const teamOf = (reviewers: Reviewer[], invited = 0) => ({ people: reviewers.filter(dealable).map((one) => one._id as string), models: reviewers.filter(readingModel).map((one) => one._id as string), invited });

/** How many people were asked by email to vote on a screening and haven't answered yet: its rule waits for them as for anyone on it. */
export const invitedTo = async (ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">) => (await invitationsTo(ctx, jobId)).length;
/** Those invitations themselves. */
export async function invitationsTo(ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">) {
  const now = Date.now();
  return (await ctx.db.query("itemInvitations").withIndex("by_item_and_state", (q) => q.eq("item", jobId).eq("state", "pending")).take(MAX_REVIEWERS)).filter((one) => one.role === "editor" && one.expiresAt > now);
}

/**
 * Who settles a screening's conflicts once the person who did can't: one of the people reviewing it (its maker first,
 * lib/screening/rules.ts `nextResolver`), else its maker while they are still in its workspace, else someone who is.
 * Nobody is handed conflicts on a screening they can't open.
 */
export async function settlerFor(ctx: Pick<QueryCtx, "db">, job: Doc<"screeningJobs">, people: Id<"users">[], leaving?: Id<"users">) {
  if (people.length) return nextResolver(job.createdBy, people);
  const maker = job.createdBy === leaving ? null : await ctx.db.get("users", job.createdBy);
  if (maker?.state === "active" && (await actorIn(ctx, maker, job.workspaceId))) return maker._id;
  const workspace = await ctx.db.get("workspaces", job.workspaceId);
  if (workspace?.kind === "organization") {
    for (const membership of await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", workspace.organizationId).eq("state", "active")).take(MAX_REVIEWERS)) {
      const person = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", membership.clerkUserId)).unique();
      if (person?.state === "active" && person._id !== leaving) return person._id;
    }
  }
  return job.createdBy;
}

/** Someone whose account is gone still has a name where their votes are. */
export { SOMEONE };
/** A person's name wherever a screening names them, and a model's. */
export const nameOf = (user: Doc<"users"> | null | undefined) => (user ? personName(user) || user.email : SOMEONE);
export const modelName = (model: Pick<Doc<"models">, "name"> | null | undefined) => (model ? stripProviderPrefix(model.name) : "A model");

/** The papers a screening has: every one it took, less those of the sources taken out. A look under way counts its papers in as they arrive (./gathering.ts `fill`). */
export const papersOf = (job: Pick<Doc<"screeningJobs">, "totalPapers">, progress: Pick<Doc<"screeningJobProgress">, "withdrawn"> | null) => Math.max(0, job.totalPapers - (progress?.withdrawn ?? 0));

/** The papers that still wait for a reviewer: the ones they were given, less the ones they voted on, a model couldn't read, and the ones settled without them. */
export const waitingOf = (reviewer: Pick<Reviewer, "dealt">, tally: { cast?: number; failed?: number; closed?: number } | undefined) => Math.max(0, theirsOf({ dealt: reviewer.dealt, closed: tally?.closed }) - gotThrough(tally));

/** New papers of a check counted for one reviewer, past which a banner or an email says so many and more. */
export const NEW_COUNTED = 500;
/** How many of the papers a check brought still wait for one reviewer's vote, counted up to `NEW_COUNTED`. */
export async function newFor(ctx: Pick<QueryCtx, "db">, reviewerId: Id<"screeningReviewers">, check: Pick<Doc<"screeningChecks">, "from" | "added">) {
  return (await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", reviewerId).eq("status", "waiting").gte("place", check.from).lt("place", check.from + check.added)).take(NEW_COUNTED)).length;
}

/** Checks of its sources looked through for the last that brought papers. */
const CHECKS_LOOKED = 20;
/** The look a screening started with: its first check, whatever it found. One started with no source finds nothing, and the look that reads its first source later is a check like any other. */
export const firstCheck = (ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">) => ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).first();
/** A screening's latest checks for new papers that have ended, the last first. The first look in its sources is the screening starting, and is none of them. */
export async function laterChecks(ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">) {
  const [first, last] = await Promise.all([firstCheck(ctx, jobId), ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).order("desc").take(CHECKS_LOOKED)]);
  return last.filter((check) => check.state === "done" && check._id !== first?._id);
}

/** What each of a screening's models can be given, by its row or by whatever names it before it has one: whether it takes a PDF as a file, and the tokens one call to it holds. */
export type Reads = Map<string, { files: boolean; room?: number }>;
export const readOf = (model: Pick<Doc<"models">, "inputModalities" | "contextLength"> | null) => ({ files: readsPdfs(model?.inputModalities), ...(model?.contextLength === undefined ? {} : { room: model.contextLength }) });
/** That, for the models on a screening: read once for a batch of its papers. */
export async function readsOf(ctx: Pick<QueryCtx, "db">, reviewers: Reviewer[]): Promise<Reads> {
  const models = reviewers.filter((one) => one.kind === "model");
  const rows = await Promise.all(models.map((one) => (one.modelId ? ctx.db.get("models", one.modelId) : null)));
  return new Map(models.map((one, at) => [one._id as string, readOf(rows[at]!)]));
}
type Readable = Pick<Doc<"screeningResults">, "abstract" | "file" | "pages">;
/**
 * The team one paper goes to: every person, and the models that can read it. A paper with no abstract is its PDF,
 * which a model reads only where it takes files and this one fits a call. A model that can't is never given the
 * paper: it has nothing to fail on there, nothing to pay for, and no say in it, and the others settle it.
 */
export const teamFor = <Team extends { people: string[]; models: string[] }>(team: Team, paper: Readable, reads: Reads): Team =>
  paper.abstract || !paper.file ? team : { ...team, models: team.models.filter((id) => readsPdfOf(reads.get(id), paper.pages ?? 0)) };

/** Questions put to one person on one screening that its pages count and open, and how many open ones are looked through for them, a hundred at a time: papers that left with their source are passed over. */
const ASKED_SHOWN = 50;
const ASKED_STEP = 100;
const ASKED_LOOKED = 500;
/** The papers of a screening a reviewer put a question to this person about, which still waits for their answer. */
export async function askedOf(ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">, userId: Id<"users">) {
  const papers: Id<"screeningResults">[] = [];
  const seen = new Set<Id<"screeningResults">>();
  let after = -1;
  for (let looked = 0; looked < ASKED_LOOKED && papers.length < ASKED_SHOWN; looked += ASKED_STEP) {
    const open = await ctx.db.query("screeningMessages").withIndex("by_job_and_to_and_open", (q) => q.eq("jobId", jobId).eq("to", userId).eq("open", true).gt("_creationTime", after)).take(ASKED_STEP);
    const fresh = [...new Set(open.map((message) => message.resultId))].filter((id) => !seen.has(id));
    fresh.forEach((id) => seen.add(id));
    // A paper that left with its source keeps its question for when it comes back, and asks nothing while it is out.
    const out = await Promise.all(fresh.map(async (id) => Boolean((await ctx.db.get("screeningResults", id))?.withdrawn)));
    papers.push(...fresh.filter((_, at) => !out[at]));
    if (open.length < ASKED_STEP) break;
    after = open[open.length - 1]._creationTime;
  }
  return papers.slice(0, ASKED_SHOWN);
}

/** Where a question put to someone is opened for them to answer. */
export type AskedWhere = "conflicts" | "screen" | "done" | "papers";

/** Papers in conflict counted for whoever settles them, past which the count says so many. */
const CONFLICTS_COUNTED = 500;
const waitingIn = (tally: Record<string, number>) => Object.values(tally).reduce((sum, n) => sum + n, 0);

/**
 * What waits for one person on one screening: papers for their vote and conflicts for them to settle, none once it
 * is finished, and the papers someone asked them about. One function, for the list, the rail and every summary.
 */
export async function waitsOn(ctx: Pick<QueryCtx, "db">, job: Doc<"screeningJobs">, userId: Id<"users">, reviewer: Doc<"screeningReviewers"> | null) {
  const open = job.finishedAt === undefined;
  const asked = await askedOf(ctx, job._id, userId);
  // Where the first question is answered: on Screen among the conflicts by whoever settles a paper in conflict, on Screen by one of its reviewers (in Done once they voted on it), and in Papers by anyone else.
  const first = asked[0] ? await ctx.db.get("screeningResults", asked[0]) : null;
  // A reviewer who has voted on the paper finds it in Done, never under a To do that doesn't hold it.
  const voted = first && reviewer && reviewer.left === undefined ? (await ctx.db.query("screeningVotes").withIndex("by_result_and_reviewer", (q) => q.eq("resultId", first._id).eq("reviewerId", reviewer._id)).first())?.status === "cast" : false;
  const askedWhere: AskedWhere | undefined = first ? (job.rule?.resolver === userId && first.result === "conflict" ? "conflicts" : reviewer && reviewer.left === undefined ? (voted ? "done" : "screen") : "papers") : undefined;
  // Read from the person's own votes and the papers in conflict, never from the screening's running counts: a vote anyone else casts doesn't make every page that says what waits for the person read again.
  return {
    forYou: open && reviewer && reviewer.left === undefined ? waitingIn(await tallyOfReviewer(ctx as QueryCtx, reviewer._id, ["waiting"])) : 0,
    conflicts: open && job.rule?.resolver === userId ? (await ctx.db.query("screeningCards").withIndex("by_job_and_result", (q) => q.eq("jobId", job._id).eq("result", "conflict")).take(CONFLICTS_COUNTED)).length : 0,
    asked,
    ...(askedWhere ? { askedWhere } : {}),
  };
}

/**
 * A source set to be read again from its start: at a check, and when its range changes. Its reading is a new pass, so
 * what an earlier pass left out is told from what this one does. What it merges and leaves out is counted afresh
 * beside the figures it has (`next`), which stand until this reading is whole (./gathering.ts `fill`). The papers
 * it brought stay its papers, and so do the ones read as their PDF among them.
 */
export const readAgain = (source: Pick<Doc<"screeningSources">, "pass" | "next">) => ({ state: "waiting" as const, read: 0, resume: undefined, snapshot: undefined, failure: undefined, capped: undefined, pass: (source.pass ?? 0) + 1, next: { from: source.next?.from ?? source.pass ?? 0, duplicates: 0, left: 0, bare: 0 } });

/** What marks a screening as just changed: when it was, for its row and for the order of the list. */
export const touched = (now = Date.now()) => ({ updatedAt: now, activeAt: now });

/** Whether a screening's models may take papers now: not while they are paused, it is finished, or its workspace is out of credits. */
export const modelsFree = (job: Doc<"screeningJobs">) => !job.paused && !job.outOfCredits && job.finishedAt === undefined;

/** A model's row on a paper: waiting for one of its workspace's slots, oldest screening first, unless the models are held. */
export const modelRow = (job: Doc<"screeningJobs">, paper: Pick<Doc<"screeningResults">, "_id" | "place">, reviewer: Reviewer) => ({
  jobId: job._id,
  resultId: paper._id,
  reviewerId: reviewer._id,
  place: paper.place ?? 0,
  status: "waiting" as const,
  ...(modelsFree(job) ? { waitingWorkspace: job.workspaceId, waitingSince: job.createdAt } : {}),
});
// `lean` starts at none of its models: every waiting place has a number, so the index that orders by it holds them all.
export const personRow = (job: Doc<"screeningJobs">, paper: Pick<Doc<"screeningResults">, "_id" | "place">, reviewer: Reviewer) => ({ jobId: job._id, resultId: paper._id, reviewerId: reviewer._id, place: paper.place ?? 0, status: "waiting" as const, lean: 0 });

/**
 * Gives a paper that just arrived to its reviewers, and says how many rows each got, for the caller to add to
 * their `dealt` once for the whole step.
 */
export async function dealNew(ctx: MutationCtx, job: Doc<"screeningJobs">, paper: Readable & Pick<Doc<"screeningResults">, "_id" | "place">, reviewers: Reviewer[], reads: Reads, dealt: Map<Id<"screeningReviewers">, number>) {
  // The sum that deals every later change deals the first time too, to a paper with no places yet.
  const { made } = project({ id: paper._id, place: paper.place ?? 0, result: "waiting", held: false, away: [] }, [], teamFor(teamOf(reviewers), paper, reads), job.rule!, job.criteria ?? [], { models: true });
  for (const place of made) {
    const reviewer = reviewers.find((one) => one._id === place.reviewer)!;
    await ctx.db.insert("screeningVotes", place.kind === "model" ? modelRow(job, paper, reviewer) : personRow(job, paper, reviewer));
    dealt.set(reviewer._id, (dealt.get(reviewer._id) ?? 0) + 1);
  }
}

/** Adds what a step dealt to each reviewer's count of papers. */
export async function countDealt(ctx: MutationCtx, dealt: Map<Id<"screeningReviewers">, number>) {
  for (const [reviewerId, more] of dealt) {
    const reviewer = more ? await ctx.db.get("screeningReviewers", reviewerId) : null;
    if (reviewer) await ctx.db.patch("screeningReviewers", reviewerId, { dealt: Math.max(0, reviewer.dealt + more) });
  }
}

/** The last reading of a source that was whole: the one its figures count (`duplicates`, `left`), which a reading still going leaves standing until it is whole itself. */
export const wholePass = (source: Pick<Doc<"screeningSources">, "pass" | "next">) => source.next?.from ?? source.pass ?? 0;
/** Whether that reading met a record of the source. One a reading still going has met again says so in `before`, and one it met for the first time waits for it to be whole: the lists hold what the figures count. */
export const inWhole = (source: Pick<Doc<"screeningSources">, "pass" | "next">, row: { pass?: number; before?: number }) => !source.next || (row.pass ?? 0) === source.next.from || row.before === source.next.from;

/**
 * The source still in the screening that holds a paper too, merged into it by its last whole reading: it keeps the
 * paper, with its votes, when the paper's own source is taken out. Asked of each of the screening's sources, a few.
 */
export async function keeperOf(ctx: Pick<QueryCtx, "db">, paperId: Id<"screeningResults">, leaving: Set<Id<"screeningSources">>, sources: Doc<"screeningSources">[]) {
  for (const source of sources) {
    if (leaving.has(source._id) || source.removedAt !== undefined) continue;
    const rows = await ctx.db.query("screeningMerged").withIndex("by_into_and_source", (q) => q.eq("into", paperId).eq("sourceId", source._id)).take(MERGED_LOOKED);
    const row = rows.find((one) => one.pass >= wholePass(source) && inWhole(source, one));
    if (row) return { source, row };
  }
  return null;
}
/** One source's records merged into one paper, looked through for its current one: a file lists a paper a few times at most. */
const MERGED_LOOKED = 20;

/**
 * A page of one source's merged records, for what a change says before it is made: how many papers of the sources
 * being taken out this source keeps (`keeperOf`). Each is counted under its keeper alone, the first source that holds
 * it, so a paper two sources hold counts once. The papers that leave are the ones no other source holds.
 */
export async function keptPage(ctx: Pick<QueryCtx, "db">, source: Doc<"screeningSources">, leaving: Set<Id<"screeningSources">>, sources: Doc<"screeningSources">[], cursor: string | null) {
  const page = await ctx.db.query("screeningMerged").withIndex("by_source_and_pass", (q) => q.eq("sourceId", source._id).gte("pass", wholePass(source))).paginate({ cursor, numItems: MERGED_COUNTED });
  let kept = 0;
  for (const row of page.page) {
    if (!inWhole(source, row)) continue;
    const paper = await ctx.db.get("screeningResults", row.into);
    if (!paper || paper.withdrawn || !paper.sourceId || !leaving.has(paper.sourceId)) continue;
    if ((await keeperOf(ctx, paper._id, leaving, sources))?.row._id === row._id) kept++;
  }
  return { kept, cursor: page.isDone ? null : page.continueCursor };
}
/** One source's merged records read in a step of that count, each with its paper and its keeper. */
const MERGED_COUNTED = 300;

/**
 * Whether the person looking sees how a paper's other reviewers voted, and so what was written about it: once the
 * screening allows (lib/screening/rules.ts `seesVotes`), or where no other person is on the paper and its models only
 * advise or it has none, since then there is nothing to keep. One test for the paper's views, its discussion and what is written to it.
 */
export function seesPaper(job: Pick<Doc<"screeningJobs">, "rule" | "finishedAt">, result: Doc<"screeningResults">["result"], votes: Array<Pick<Doc<"screeningVotes">, "reviewerId" | "status">>, kindOf: (id: Id<"screeningReviewers">) => "person" | "model" | undefined, me: Id<"screeningReviewers"> | undefined) {
  const mine = me ? votes.find((vote) => vote.reviewerId === me) : undefined;
  // As the rule says what it hides (lib/screening/rules.ts `hidesVotes`): with no other person on the paper, nothing is kept where its models only advise or it has none.
  const others = (kind: "person" | "model") => votes.some((vote) => vote.status !== "discarded" && vote.reviewerId !== me && kindOf(vote.reviewerId) === kind);
  const alone = !others("person") && (advisory(job.rule!) || !others("model"));
  return alone || seesVotes(job.rule!.blind, result ?? "waiting", mine?.status === "waiting" ? "waiting" : undefined, job.finishedAt !== undefined);
}

/** The guests of a screening looked through as it reopens for reviewers it took on while finished: more than any plan lets it have. */
const GUESTS_PLACED = 100;
/**
 * Whoever was given a screening to review while it was finished had no place on it then, or had left it: as it reopens,
 * by Reopen or by a check that brings papers, each gets their place, and their papers with it (./reviewers.ts `guestChanged`).
 */
export async function placeGuests(ctx: MutationCtx, jobId: Id<"screeningJobs">) {
  const on = new Set((await reviewersOf(ctx, jobId)).flatMap((one) => (one.kind === "person" && one.left === undefined ? [one.userId] : [])));
  for (const grant of await ctx.db.query("itemAccess").withIndex("by_item_and_grantedAt", (q) => q.eq("item", jobId)).take(GUESTS_PLACED)) {
    if (grant.role === "editor" && !on.has(grant.userId)) await ctx.scheduler.runAfter(0, internal.screening.reviewers.guestChanged, { item: jobId, userId: grant.userId, reopened: true });
  }
}

/** Keeps what a screening's rule and criteria are from now on, as a version of them the whole record lists. A change nobody made by hand (who settles conflicts passing on when they leave) has no one behind it. */
export async function keepVersion(ctx: MutationCtx, job: Doc<"screeningJobs">, by?: Id<"users">) {
  if (job.rule) await ctx.db.insert("screeningVersions", { jobId: job._id, at: Date.now(), ...(by ? { by } : {}), rule: job.rule, criteria: job.criteria ?? [] });
}
