/**
 * Where each paper of a screening with reviewers stands (plans/screening-reviewers), worked out by the bookkeeping
 * worker alone (./bookkeeping.ts). Whatever changes a paper's votes stamps the paper `doneAt`; the worker then, a
 * batch at a time, settles each paper on its votes under the screening's rule, brings its places in step with the
 * people on it, and counts what changed: the screening's papers by result, the excluded ones by reason, each
 * reviewer's votes, and how each pair of reviewers agreed. Nothing else writes any of these, so votes arriving
 * together never write the same document.
 *
 * A paper that was settled keeps its result through a change of settings (`heldAt` on the screening): a model
 * reading on never moves it. A person's vote on it lets it go, and so does a check of the settled papers.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { cellOf, DECISIONS, emptyMatrix, isFinal, reasonOf, scoreOf, type Answer, type Decision, type Result } from "../../lib/screening/rules";
import { newCollection } from "../library/collections";
import { progressOf, shelve, withMoved } from "./bookkeeping";
import { ballotOf, project, type Place, type Projected } from "../../lib/screening/project";
import { countDealt, modelRow, personRow, reviewersOf, teamOf, votesOf } from "./dealing";
import { conflictsWait } from "./notices";
import type { Infer } from "convex/values";
import type { reviewerCountsValidator } from "./validators";

type Paper = Doc<"screeningResults">;
type Vote = Doc<"screeningVotes">;
type Reviewer = Doc<"screeningReviewers">;
type Counts = Infer<typeof reviewerCountsValidator>;
type Counted = NonNullable<Vote["counted"]>;

const ACTIVE_EVERY_MS = 60_000;
const NO_COUNTS: Counts = { cast: 0, include: 0, maybe: 0, exclude: 0, failed: 0, closed: 0, spent: 0 };
export const NO_RESULTS = { include: 0, maybe: 0, exclude: 0, conflict: 0 };
/**
 * Where a paper stands, under the name everything outside the screening's own pages still reads it by: an
 * extraction that takes a screening's included papers, another screening that takes them as a source, the old
 * exports. Kept in step with `result` here, with the progress row's `qualified`, until those read `result`.
 */
const OUTCOME: Record<Result, Doc<"screeningResults">["outcome"]> = { include: "included", maybe: "unclear", exclude: "excluded", conflict: undefined, waiting: undefined };

/** A vote's row as the rules read a place (lib/screening/project.ts). */
export const placeOf = (vote: Vote, reviewer: Reviewer | undefined): Place => ({ reviewer: vote.reviewerId, kind: reviewer?.kind ?? "person", status: vote.status, ...(vote.decision ? { decision: vote.decision } : {}), ...(vote.reason ? { reason: vote.reason } : {}), ...(vote.at === undefined ? {} : { at: vote.at }), ...(vote.answers ? { answers: vote.answers as Record<string, Answer> } : {}) });

/** What a vote adds to its reviewer's counts, by sign. */
function add(counts: Counts, counted: Counted | undefined, sign: 1 | -1) {
  if (!counted) return;
  if (counted.status === "cast") counts.cast += sign;
  if (counted.status === "cast" && counted.decision) counts[counted.decision] += sign;
  if (counted.status === "failed") counts.failed += sign;
  if (counted.status === "closed") counts.closed += sign;
  counts.spent += sign * (counted.credits ?? 0);
}

const same = (a: Counted | undefined, b: Counted) => a?.status === b.status && a.decision === b.decision && (a.credits ?? 0) === (b.credits ?? 0);

/**
 * Settles a batch of one screening's papers, and returns how many slots their finished readings freed and how many
 * new readings were made, for the worker to start the workspace's next ones.
 */
export async function settlePapers(ctx: MutationCtx, made: Doc<"screeningJobs">, papers: Paper[]) {
  let job = made;
  const reviewers = await reviewersOf(ctx, job._id);
  const byId = new Map(reviewers.map((one) => [one._id, one]));
  const order = new Map(reviewers.map((one, at) => [one._id, at]));
  const progress = await progressOf(ctx, job._id);
  const counts = { ...NO_RESULTS, ...progress.counts };
  const reasons = { ...progress.reasons };
  const included: Record<string, number> = { ...progress.included };
  const perReviewer = new Map<Id<"screeningReviewers">, Counts>();
  const countsOf = (id: Id<"screeningReviewers">) => perReviewer.get(id) ?? perReviewer.set(id, { ...NO_COUNTS, ...progress.reviewers?.[id] }).get(id)!;
  const pairs = new Map<string, { a: Id<"screeningReviewers">; b: Id<"screeningReviewers">; cells: number[] }>();
  const pair = (x: Id<"screeningReviewers">, y: Id<"screeningReviewers">, first: Decision, second: Decision, sign: 1 | -1) => {
    const [a, b, cell] = (order.get(x) ?? 0) <= (order.get(y) ?? 0) ? [x, y, cellOf(first, second)] : [y, x, cellOf(second, first)];
    const held = pairs.get(`${a}:${b}`) ?? pairs.set(`${a}:${b}`, { a, b, cells: emptyMatrix() }).get(`${a}:${b}`)!;
    held.cells[cell]! += sign;
  };
  const moved = { saved: 0, removed: 0 };
  let withdrawn = 0;
  // Rows this pass made or took away, by reviewer: what it adds to their count of papers.
  const dealt = new Map<Id<"screeningReviewers">, number>();
  let freed = 0;
  let queued = 0;
  let conflicts = false;
  const ballot = (vote: Vote) => ballotOf(placeOf(vote, byId.get(vote.reviewerId)), job.criteria ?? []);

  const team = teamOf(reviewers);
  for (const paper of papers) {
    let votes = await votesOf(ctx, paper._id);
    const ballots = () => votes.map(ballot);
    const was: Result = paper.result ?? "waiting";
    // Held through a change of settings: settled by then, and nobody has voted on it or asked for it to be checked again since.
    // One brought over from before screenings had reviewers stands as it stood then, until someone votes on it or its settled papers are checked again.
    const carried = paper.kept && !paper.resolved && !paper.reopen ? paper.kept : undefined;
    const held = carried !== undefined || (isFinal(paper.result) && !paper.resolved && !paper.reopen && (paper.settledAt ?? 0) <= (job.heldAt ?? 0));
    // Where it stands and who is on it is one sum, the same one a change's preview runs (lib/screening/project.ts): this applies it to the rows.
    const places = votes.map((vote) => placeOf(vote, byId.get(vote.reviewerId)));
    // One whose source was taken out stands nowhere: the places nobody voted from go, and its votes stay on record and count for nothing.
    const plan: Pick<Projected, "result" | "made" | "reopened" | "closed" | "gone"> = paper.withdrawn
      ? { result: "waiting", made: [], reopened: [], closed: [], gone: places.filter((place) => place.status === "waiting" || place.status === "closed") }
      : project({ id: paper._id, place: paper.place ?? 0, result: carried ?? was, ...(paper.resolved ? { resolved: paper.resolved.decision } : {}), held, away: (paper.away ?? []) as string[] }, places, team, job.rule!, job.criteria ?? [], { models: paper.reopen === "recheck" });
    const now = plan.result;
    if (Boolean(paper.withdrawn) !== Boolean(paper.out)) withdrawn += paper.withdrawn ? 1 : -1;
    const rowOf = (place: Place) => votes[places.indexOf(place)]!;
    // A reading under way finishes and is paid for: its place goes once the reading has come back.
    const leaving = plan.gone.map(rowOf).filter((vote) => vote.workId === undefined);
    for (const vote of leaving) {
      await ctx.db.delete("screeningVotes", vote._id);
      add(countsOf(vote.reviewerId), vote.counted, -1);
      if (vote.counted?.status !== "discarded") dealt.set(vote.reviewerId, (dealt.get(vote.reviewerId) ?? 0) - 1);
      if (vote.slot) freed++;
    }
    for (const place of plan.reopened) await ctx.db.patch("screeningVotes", rowOf(place)._id, { status: "waiting" });
    for (const place of plan.closed) if (places.includes(place)) await ctx.db.patch("screeningVotes", rowOf(place)._id, { status: "closed" });
    const fresh: Vote[] = [];
    for (const place of plan.made) {
      const reviewer = byId.get(place.reviewer as Id<"screeningReviewers">)!;
      // A place given and closed in one pass, on a paper another vote settled meanwhile, is made closed.
      const row = { ...(place.kind === "model" ? modelRow(job, paper, reviewer) : personRow(job, paper, reviewer)), ...(plan.closed.includes(place) ? { status: "closed" as const } : {}) };
      fresh.push((await ctx.db.get("screeningVotes", await ctx.db.insert("screeningVotes", row)))!);
      dealt.set(reviewer._id, (dealt.get(reviewer._id) ?? 0) + 1);
      if (place.kind === "model" && "waitingWorkspace" in row) queued++;
    }
    const gone = new Set(leaving);
    const status = new Map([...plan.reopened.map((place) => [rowOf(place)._id, "waiting"] as const), ...plan.closed.filter((place) => places.includes(place)).map((place) => [rowOf(place)._id, "closed"] as const)]);
    votes = [...votes.filter((vote) => !gone.has(vote)).map((vote) => (status.has(vote._id) ? { ...vote, status: status.get(vote._id)! } : vote)), ...fresh];

    // Each vote adds what it now is to its reviewer's counts, and each pair of votes to their agreement.
    const before = votes.flatMap((vote) => (vote.counted?.status === "cast" && vote.counted.decision ? [{ id: vote.reviewerId, decision: vote.counted.decision }] : []));
    const after: typeof before = [];
    let changed = false;
    for (const vote of votes) {
      const cast = ballot(vote);
      // What a model's reading cost is kept counted whatever becomes of its paper: the credits went.
      const counted: Counted = paper.withdrawn ? { status: "discarded", ...(vote.credits ? { credits: vote.credits } : {}) } : { status: vote.status, ...(cast.decision ? { decision: cast.decision } : {}), ...(vote.credits ? { credits: vote.credits } : {}) };
      if (!paper.withdrawn && cast.status === "cast" && cast.decision) after.push({ id: vote.reviewerId, decision: cast.decision });
      // The slot is free once the reading has come back, whatever it left on the row: a reading that didn't go ahead leaves it waiting.
      const finished = vote.slot && vote.workId === undefined;
      if (finished) freed++;
      if (same(vote.counted, counted) && !finished && vote.decision === cast.decision) continue;
      changed = true;
      // A vote that stops counting is no longer one of its reviewer's papers, and one that counts again is.
      if ((vote.counted?.status === "discarded") !== (counted.status === "discarded")) dealt.set(vote.reviewerId, (dealt.get(vote.reviewerId) ?? 0) + (counted.status === "discarded" ? -1 : 1));
      add(countsOf(vote.reviewerId), vote.counted, -1);
      add(countsOf(vote.reviewerId), counted, 1);
      // A model's vote follows its answers under the criteria as they are now, so its decision can move with them.
      await ctx.db.patch("screeningVotes", vote._id, { counted, ...(cast.status === "cast" && vote.decision !== cast.decision ? { decision: cast.decision, reason: cast.reason } : {}), ...(finished ? { slot: undefined } : {}) });
    }
    if (changed || before.length !== after.length) {
      for (const [i, x] of before.entries()) for (const y of before.slice(i + 1)) pair(x.id, y.id, x.decision, y.decision, -1);
      for (const [i, x] of after.entries()) for (const y of after.slice(i + 1)) pair(x.id, y.id, x.decision, y.decision, 1);
    }
    // The papers the screening included that a reviewer voted to exclude: counted for each of them as the paper's result and their vote stand.
    if (was === "include") for (const one of before) if (one.decision === "exclude") countsOf(one.id).missed = Math.max(0, (countsOf(one.id).missed ?? 0) - 1);
    if (now === "include" && !paper.withdrawn) for (const one of after) if (one.decision === "exclude") countsOf(one.id).missed = (countsOf(one.id).missed ?? 0) + 1;
    if (paper.sourceId && was === "include") included[paper.sourceId] = Math.max(0, (included[paper.sourceId] ?? 1) - 1);
    if (paper.sourceId && now === "include" && !paper.withdrawn) included[paper.sourceId] = (included[paper.sourceId] ?? 0) + 1;

    const cast = ballots();
    // How many of its models would include it goes on the places its people have yet to vote from, for the order that puts those papers first.
    const lean = -votes.filter((vote, at) => byId.get(vote.reviewerId)?.kind === "model" && cast[at]!.status === "cast" && cast[at]!.decision === "include").length;
    for (const vote of votes) if (vote.status === "waiting" && byId.get(vote.reviewerId)?.kind === "person" && (vote.lean ?? 0) !== lean) await ctx.db.patch("screeningVotes", vote._id, { lean });
    const given = cast.flatMap((one) => (one.status === "cast" && one.decision ? [one.decision] : []));
    const split = given.length - Math.max(0, ...DECISIONS.map((decision) => given.filter((one) => one === decision).length));
    const reason = now === "exclude" ? (reasonOf(cast, paper.resolved?.reason) ?? "other") : undefined;
    const { points, stars } = scoreOf(job.criteria ?? [], job.stars ?? [], cast);
    if (now === "conflict" && was !== "conflict") conflicts = true;
    if (was !== "waiting") counts[was] = Math.max(0, counts[was] - 1);
    if (now !== "waiting") counts[now]++;
    if (was === "exclude") reasons[paper.reason ?? "other"] = (reasons[paper.reason ?? "other"] ?? 1) - 1;
    if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
    const patch = paper.withdrawn ? { result: undefined, outcome: undefined, reason: undefined, split: undefined, settledAt: undefined, reopen: undefined, out: true as const } : { result: now, outcome: OUTCOME[now], reason, score: points, stars, split, reopen: undefined, out: undefined, ...(paper.kept && carried === undefined ? { kept: undefined } : {}), ...(isFinal(now) && now !== was ? { settledAt: Date.now() } : {}), ...(isFinal(now) ? {} : { settledAt: undefined }) };
    await ctx.db.patch("screeningResults", paper._id, patch);
    if (paper.withdrawn) continue;
    // Included papers go where the screening sends them, and one that ends excluded leaves the collection it came from, where that was asked.
    if ((now === "include") !== (was === "include") || (now === "exclude") !== (was === "exclude")) {
      const source = paper.sourceId ? await ctx.db.get("screeningSources", paper.sourceId) : null;
      const set = source && source.set.kind !== "upload" && source.set.kind !== "pdf" && source.set.kind !== "dois" ? source.set : undefined;
      // The collection its included papers go to is made with the first of them.
      if (now === "include" && job.newCollection && !job.targetCollectionId) {
        const targetCollectionId = await newCollection(ctx, { userId: job.createdBy, workspaceId: job.workspaceId }, job.newCollection);
        await ctx.db.patch("screeningJobs", job._id, { targetCollectionId, newCollection: undefined });
        job = { ...job, targetCollectionId, newCollection: undefined };
      }
      const to = await shelve(ctx, job, { ...paper, ...patch }, { becameIncluded: now === "include" && was !== "include", left: now === "exclude" && was !== "exclude" }, set);
      moved.saved += to.saved;
      moved.removed += to.removed;
    }
  }

  await ctx.db.patch("screeningJobProgress", progress._id, {
    counts,
    qualified: counts.include,
    reasons: Object.fromEntries(Object.entries(reasons).filter(([, n]) => n > 0)),
    included: Object.fromEntries(Object.entries(included).filter(([, n]) => n > 0)),
    ...(perReviewer.size ? { reviewers: { ...progress.reviewers, ...Object.fromEntries(perReviewer) } } : {}),
    ...(freed && progress.running ? { running: Math.max(0, progress.running - freed) } : {}),
    ...(withdrawn ? { withdrawn: Math.max(0, (progress.withdrawn ?? 0) + withdrawn) } : {}),
    ...withMoved(progress, moved),
  });
  await countDealt(ctx, dealt);
  // Whoever settles its conflicts hears that some wait: one email for a burst of them.
  if (conflicts && job.rule && job.finishedAt === undefined) await conflictsWait(ctx, job._id, job.rule.resolver);
  // When something last happened in it, kept to within a minute: whatever reads the screening's row is seldom run again for it.
  if (Date.now() - (job.activeAt ?? 0) > ACTIVE_EVERY_MS) await ctx.db.patch("screeningJobs", job._id, { activeAt: Date.now() });
  for (const { a, b, cells } of pairs.values()) {
    if (cells.every((n) => n === 0)) continue;
    const row = await ctx.db.query("screeningAgreement").withIndex("by_job_and_a_and_b", (q) => q.eq("jobId", job._id).eq("a", a).eq("b", b)).unique();
    if (row) await ctx.db.patch("screeningAgreement", row._id, { matrix: row.matrix.map((n, cell) => Math.max(0, n + cells[cell]!)) });
    else await ctx.db.insert("screeningAgreement", { jobId: job._id, a, b, matrix: cells.map((n) => Math.max(0, n)) });
  }
  return { freed, queued };
}
