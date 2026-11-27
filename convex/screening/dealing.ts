/**
 * Who a screening's papers go to (plans/screening-reviewers). A paper is given to its reviewers as a row each in
 * `screeningVotes`: so many of the people, taken in turn, and every model. This is the one place rows are made
 * for a paper, when it arrives and whenever the people, the models or the rule change.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { personName } from "../lib/people";
import { stripProviderPrefix } from "../../lib/ai/model-display";
import { project } from "../../lib/screening/project";
import { SOMEONE, gotThrough, theirsOf } from "../../lib/screening/rules";
import { readsPdfs } from "../../lib/assistant/files";
import { readsPdfOf } from "../../lib/pricing/estimate";
import { MAX_REVIEWERS, MAX_SOURCE_ROWS } from "./validators";

type Reviewer = Doc<"screeningReviewers">;

export { MAX_REVIEWERS, MAX_SOURCE_ROWS };

/** Everyone's place on one paper. */
export const votesOf = (ctx: Pick<QueryCtx, "db">, resultId: Id<"screeningResults">) => ctx.db.query("screeningVotes").withIndex("by_result", (q) => q.eq("resultId", resultId)).take(MAX_REVIEWERS);
/** A screening's sources in the order they were added, the ones taken out included. */
export const sourcesOf = (ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">) => ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(MAX_SOURCE_ROWS);

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

/** Someone whose account is gone still has a name where their votes are. */
export { SOMEONE };
/** A person's name wherever a screening names them, and a model's. */
export const nameOf = (user: Doc<"users"> | null | undefined) => (user ? personName(user) || user.email : SOMEONE);
export const modelName = (model: Pick<Doc<"models">, "name"> | null | undefined) => (model ? stripProviderPrefix(model.name) : "A model");

/** The papers a screening has: every one it took, less those of the sources taken out. While a look in its sources runs, the ones that have arrived so far. */
export const papersOf = (job: Pick<Doc<"screeningJobs">, "totalPapers">, progress: Pick<Doc<"screeningJobProgress">, "withdrawn"> | null, check?: Pick<Doc<"screeningChecks">, "from" | "added"> | null) =>
  Math.max(0, (check ? check.from + check.added : job.totalPapers) - (progress?.withdrawn ?? 0));

/** The papers that still wait for a reviewer: the ones they were given, less the ones they voted on, a model couldn't read, and the ones settled without them. */
export const waitingOf = (reviewer: Pick<Reviewer, "dealt">, tally: { cast?: number; failed?: number; closed?: number } | undefined) => Math.max(0, theirsOf({ dealt: reviewer.dealt, closed: tally?.closed }) - gotThrough(tally));

/** How many of the papers a check brought still wait for one reviewer's vote, counted up to `most`. */
export async function newFor(ctx: Pick<QueryCtx, "db">, reviewerId: Id<"screeningReviewers">, check: Pick<Doc<"screeningChecks">, "from" | "added">, most: number) {
  return (await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", reviewerId).eq("status", "waiting").gte("place", check.from).lt("place", check.from + check.added)).take(most)).length;
}

/** Checks of its sources looked through for the last that brought papers. */
const CHECKS_LOOKED = 20;
/** A screening's latest checks for new papers that have ended, the last first. The first look in its sources is the screening starting, and is none of them. */
export const laterChecks = async (ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">) =>
  (await ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).order("desc").take(CHECKS_LOOKED)).filter((check) => check.state === "done" && check.from > 0);

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

/** Questions put to one person on one screening that its pages count and open: the first of them. */
const ASKED_SHOWN = 50;
/** The papers of a screening a reviewer put a question to this person about, which still waits for their answer. */
export async function askedOf(ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">, userId: Id<"users">) {
  const open = await ctx.db.query("screeningMessages").withIndex("by_job_and_to_and_open", (q) => q.eq("jobId", jobId).eq("to", userId).eq("open", true)).take(ASKED_SHOWN);
  return [...new Set(open.map((message) => message.resultId))];
}

/**
 * What waits for one person on one screening: papers for their vote and conflicts for them to settle, none once it
 * is finished, and the papers someone asked them about. One function, for the list, the rail and every summary.
 */
export async function waitsOn(ctx: Pick<QueryCtx, "db">, job: Doc<"screeningJobs">, userId: Id<"users">, reviewer: Doc<"screeningReviewers"> | null, progress: Doc<"screeningJobProgress"> | null) {
  const open = job.finishedAt === undefined;
  return {
    forYou: open && reviewer && reviewer.left === undefined ? waitingOf(reviewer, progress?.reviewers?.[reviewer._id]) : 0,
    conflicts: open && job.rule?.resolver === userId ? (progress?.counts?.conflict ?? 0) : 0,
    asked: await askedOf(ctx, job._id, userId),
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
