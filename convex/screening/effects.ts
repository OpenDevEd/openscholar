/**
 * What a change to a running screening would do, counted before it is made (plans/screening-reviewers): which
 * results move, what each reviewer who joins gets, what becomes of the papers of one who leaves, and what the models
 * read. It runs the sum the bookkeeping worker runs (lib/screening/project.ts), on the settings as the change would
 * leave them (./settings.ts `planned`), a page of papers at a time, and keeps only counts and the first papers of
 * each move. The page that asks shows it beside the change, and the save then does what it says.
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalQuery } from "../lib/functions";
import { workspaceAction } from "../lib/userActions";
import { isFinal, modelKey, seesVotes, showsEarly, type Decision, type Result } from "../../lib/screening/rules";
import { project, withJoined, type Place } from "../../lib/screening/project";
import { requireMember } from "./access";
import { progressRow } from "./bookkeeping";
import { dealable, invitedTo, papersOf, readingModel, readOf, readsOf, sourcesOf, teamFor, votesOf } from "./dealing";
import { changeValidator, planned } from "./settings";
import { placeOf } from "./settling";
import { paperResultValidator, PREVIEW_PAPERS, previewValidator } from "./validators";

type Preview = Infer<typeof previewValidator>;
/** Papers one step of the count looks at: each with its votes, a few hundred rows. */
const STEP = 200;
/** How many slices of one result's papers are counted at once. */
const SLICES = 8;
/** A count with nothing in it yet. Made anew each time: what it holds is added to, and a shared one would carry one request's figures into the next. */
const nothing = (): Preview => ({ total: 0, reopened: 0, joining: {}, leaving: {}, eachChanged: 0, models: {}, removed: 0, included: 0, moves: [], again: 0 });
const SETTLED = ["include", "maybe", "exclude"] as const;

/** A model about to be put on the screening, by what names it before it has a row. */
const keyOf = (model: { model: string; effort?: string }) => modelKey(model.model, model.effort);

const stepArgs = { userId: v.id("users"), workspaceId: v.id("workspaces"), jobId: v.id("screeningJobs"), change: changeValidator };
const stepReturns = v.object({ counted: previewValidator, loads: v.record(v.string(), v.number()), cursor: v.union(v.string(), v.null()) });
type Step = Infer<typeof stepReturns>;

/**
 * One step of the count: a page of the papers that stand one way, each run through the change, with what the page
 * adds to every figure and to each person's papers. `recheck`: as if the settled papers were checked again, whether
 * or not the change asks.
 */
export const step = internalQuery({
  args: { ...stepArgs, result: paperResultValidator, cursor: v.union(v.string(), v.null()), recheck: v.boolean(), slice: v.object({ from: v.optional(v.number()), to: v.optional(v.number()) }) },
  returns: stepReturns,
  handler: async (ctx, { userId, workspaceId, jobId, change, result, cursor, recheck, slice }): Promise<Step> => {
    const job = await requireMember(ctx, { userId, workspaceId }, jobId);
    const plan = await planned(ctx, job, change);
    const byId = new Map(plan.reviewers.map((one) => [one._id, one]));
    const discards = new Map(plan.leaving.map(({ reviewer, discard }) => [reviewer._id as string, discard]));
    const staying = plan.reviewers.filter((one) => !discards.has(one._id));
    // Someone put back on it takes their old row again, as the save does (./reviewers.ts `addPerson`, `addModel`): the places they had on its papers are still theirs, and are counted as theirs here.
    const rows = new Map(await Promise.all(plan.models.map(async (model) => [keyOf(model), await ctx.db.query("models").withIndex("by_model_id", (q) => q.eq("modelId", model.model)).first()] as const)));
    const back = new Map<string, string>([
      ...plan.joining.flatMap(({ userId: id }): Array<[string, string]> => { const old = plan.reviewers.find((one) => one.kind === "person" && one.userId === id); return old ? [[id, old._id]] : []; }),
      ...plan.models.flatMap((model): Array<[string, string]> => { const row = rows.get(keyOf(model)); const old = row && plan.reviewers.find((one) => one.kind === "model" && one.modelId === row._id && one.effort === model.effort); return old ? [[keyOf(model), old._id]] : []; }),
    ]);
    const idOf = (key: string) => back.get(key) ?? key;
    // The form names a person by their account, and a model put back by its row.
    const keyOfRow = new Map(plan.joining.flatMap(({ userId: id }): Array<[string, string]> => (back.has(id) ? [[back.get(id)!, id]] : [])));
    const joiners = plan.joining.map(({ userId: id, before }) => ({ id: idOf(id), before }));
    const [readers, newModels] = [staying.filter(readingModel).map((one) => one._id as string), plan.models.map((model) => idOf(keyOf(model)))];
    // Who papers go to once the change is made: the people dealt to, in the order they joined, the ones who join last, and the models that read.
    const team = { people: [...staying.filter(dealable).map((one) => one._id as string), ...joiners.map((one) => one.id)], models: [...readers, ...newModels], invited: (await invitedTo(ctx, jobId)) + (change.inviting ?? 0) };
    const mine = plan.reviewers.find((one) => one.userId === userId && one.left === undefined)?._id;
    // What each model, on it already or about to join, can be given: a paper that is only its PDF goes to the ones that take files.
    const reads = await readsOf(ctx, staying);
    for (const model of plan.models) reads.set(idOf(keyOf(model)), readOf(rows.get(keyOf(model)) ?? null));

    const joining: Preview["joining"] = Object.fromEntries([...joiners.map((one) => [one.id, { dealt: 0 }]), ...newModels.map((key) => [key, { reads: 0 }])]);
    const leaving: Preview["leaving"] = Object.fromEntries([...discards.keys()].map((id) => [id, { cast: 0, unvoted: 0, voted: 0, to: [] as string[], settled: 0, waiting: 0 }]));
    const models: Preview["models"] = Object.fromEntries(readers.map((id) => [id, { ahead: 0, atOnce: 0 }]));
    const moves = new Map<string, Preview["moves"][number]>();
    const loads: Record<string, number> = {};
    let [reopened, eachChanged] = [0, 0];

    const page = await ctx.db.query("screeningResults").withIndex("by_job_and_result_and_place", (q) => { const one = q.eq("jobId", jobId).eq("result", result); return slice.from === undefined ? (slice.to === undefined ? one : one.lt("place", slice.to)) : slice.to === undefined ? one.gte("place", slice.from) : one.gte("place", slice.from).lt("place", slice.to); }).paginate({ cursor, numItems: STEP });
    for (const paper of page.page) {
      if (paper.withdrawn) continue;
      const before = (await votesOf(ctx, paper._id)).map((vote) => placeOf(vote, byId.get(vote.reviewerId)));
      const was: Result = paper.result ?? "waiting";
      const thrown = before.some((place) => discards.get(place.reviewer) && place.status === "cast");
      // As the save leaves them: the votes of a reviewer taken off stay unless they are thrown out, the models answer a new criterion on the papers still open, and whoever joins takes their share of the places nobody voted from.
      const left = before.map((place): Place => {
        if (discards.get(place.reviewer) && place.status === "cast") return { ...place, status: "discarded" };
        if (plan.added.length && !isFinal(was) && place.status === "cast" && readers.includes(place.reviewer)) return { ...place, status: "waiting" };
        return place;
      });
      const places = withJoined({ id: paper._id, result: was }, left, joiners, plan.rule.each === "all");
      // A settled paper keeps its result through the change, unless it is checked again or votes on it are thrown out.
      const held = isFinal(was) && !paper.resolved && !recheck && !thrown;
      const onIt = teamFor(team, paper, reads);
      // A paper someone else has voted on, whose votes the person asking can't see yet: that they voted shows already (./paperViews.ts `hidden`), how doesn't. Nothing that depends on how the others voted on it is worked out: where the change leaves it, whether it stays open, what is left of anyone's papers on it. Any of those, even as a count, would say whether the others agree. Who is on it shows, so the places are counted as the change gives them out before a vote is read, with every model that joins taken to read it: a cost is never under what is charged. Where the change can move a result, the paper is counted once, under no result, whether or not it would move.
      const kept = before.some((place) => place.reviewer !== mine && place.status === "cast" && !showsEarly(job.rule!, place.kind)) && !seesVotes(job.rule!.blind, was, before.some((place) => place.reviewer === mine && place.status === "waiting") ? "waiting" : undefined, job.finishedAt !== undefined);
      const after = kept ? null : project({ id: paper._id, place: paper.place ?? 0, result: was, ...(paper.resolved ? { resolved: paper.resolved.decision as Decision } : {}), held, away: (paper.away ?? []) as string[] }, places, onIt, plan.rule, plan.criteria, { models: recheck || !isFinal(was) });
      const now = after?.result ?? was;
      const open = after ? !isFinal(now) : true;
      const ends: Place[] = after?.places ?? [...places, ...newModels.filter((key) => onIt.models.includes(key) && !places.some((place) => place.reviewer === key)).map((key): Place => ({ reviewer: key, kind: "model", status: "waiting" }))];

      if (kept ? plan.moves : now !== was) {
        const [from, to] = kept ? (["waiting", "waiting"] as const) : [was, now];
        const move = moves.get(`${from}>${to}`) ?? { from, to, count: 0, papers: [], hidden: 0 };
        move.count++;
        if (kept) move.hidden++;
        else if (move.papers.length < PREVIEW_PAPERS) move.papers.push({ id: paper._id, title: paper.title, ...(paper.publicationYear === undefined ? {} : { year: paper.publicationYear }) });
        moves.set(`${from}>${to}`, move);
        if (!kept && open) reopened++;
      }

      // Each person's papers: a place counts for whoever holds it, unless their vote was thrown out.
      const holders = (list: Place[]) => list.filter((place) => place.kind === "person" && place.status !== "discarded");
      const [had, has] = [holders(before), holders(ends)];
      if (open && had.length !== has.length) eachChanged++;
      for (const place of had) loads[place.reviewer] = (loads[place.reviewer] ?? 0) - 1;
      for (const place of has) loads[place.reviewer] = (loads[place.reviewer] ?? 0) + 1;

      for (const place of ends) {
        if (place.status !== "waiting") continue;
        const earlier = before.find((one) => one.reviewer === place.reviewer);
        // A person who joins gets the open papers they are on. A model that joins reads the ones it is put on.
        if (joining[place.reviewer]) joining[place.reviewer] = place.kind === "model" ? { reads: (joining[place.reviewer]!.reads ?? 0) + 1 } : { dealt: (joining[place.reviewer]!.dealt ?? 0) + 1 };
        // A model that stays has the paper still to read, and reads it at once where the change is what asks.
        if (models[place.reviewer]) models[place.reviewer] = { ahead: models[place.reviewer]!.ahead + 1, atOnce: models[place.reviewer]!.atOnce + (earlier?.status === "waiting" ? 0 : 1) };
      }

      // What becomes of the papers of a person taken off: taken by someone else, settled on the votes that remain, or still waiting for them.
      const takers = has.filter((place) => !had.some((one) => one.reviewer === place.reviewer)).map((place) => place.reviewer);
      for (const [id, discard] of discards) {
        const place = before.find((one) => one.reviewer === id && one.kind === "person");
        if (!place || !(place.status === "waiting" || (place.status === "cast" && discard))) continue;
        const gone = leaving[id]!;
        if (takers.length) leaving[id] = { ...gone, ...(place.status === "cast" ? { voted: gone.voted + 1 } : { unvoted: gone.unvoted + 1 }), to: [...new Set([...gone.to, ...takers])] };
        else if (place.status === "waiting") leaving[id] = { ...gone, ...(open ? { waiting: gone.waiting + 1 } : { settled: gone.settled + 1 }) };
      }
    }
    // Whoever joins is named as the form names them.
    const joined = Object.fromEntries(Object.entries(joining).map(([id, counts]) => [keyOfRow.get(id) ?? id, counts]));
    return { counted: { ...nothing(), reopened, eachChanged, joining: joined, leaving, models, moves: [...moves.values()] }, loads, cursor: page.isDone ? null : page.continueCursor };
  },
});

const startReturns = v.object({ total: v.number(), places: v.number(), removed: v.number(), included: v.number(), decides: v.boolean(), discards: v.boolean(), cast: v.record(v.string(), v.number()), dealt: v.record(v.string(), v.number()) });
type Start = Infer<typeof startReturns>;

/** What is known of a change without looking at a paper: what the screening has, what the change takes out, the votes of whoever it takes off, and the papers each person has before it. */
export const start = internalQuery({
  args: stepArgs,
  returns: startReturns,
  handler: async (ctx, { userId, workspaceId, jobId, change }): Promise<Start> => {
    const job = await requireMember(ctx, { userId, workspaceId }, jobId);
    const plan = await planned(ctx, job, change);
    const progress = await progressRow(ctx, jobId);
    const removed = (await sourcesOf(ctx, jobId)).filter((source) => change.removeSources?.includes(source._id) && source.removedAt === undefined).reduce((sum, source) => sum + source.taken, 0);
    const gone = new Set<Id<"screeningReviewers">>(plan.leaving.map(({ reviewer }) => reviewer._id));
    return {
      total: Math.max(0, papersOf(job, progress) - removed),
      places: job.totalPapers,
      removed,
      included: progress?.counts?.include ?? 0,
      decides: plan.decides,
      discards: plan.leaving.some(({ discard }) => discard),
      cast: Object.fromEntries(plan.leaving.map(({ reviewer }) => [reviewer._id, progress?.reviewers?.[reviewer._id]?.cast ?? 0])),
      dealt: Object.fromEntries([...plan.reviewers.filter((one) => dealable(one) && !gone.has(one._id)).map((one) => [one._id, one.dealt] as const), ...plan.joining.map((one) => { const old = plan.reviewers.find((row) => row.kind === "person" && row.userId === one.userId); return old ? ([old._id, old.dealt] as const) : ([one.userId, 0] as const); })]),
    };
  },
});

/** Adds one step's figures to the count so far. The papers a move names stay the first few. */
function add(into: Preview, loads: Record<string, number>, read: Step) {
  const page = read.counted;
  into.reopened += page.reopened;
  into.eachChanged += page.eachChanged;
  for (const move of page.moves) {
    const held = into.moves.find((one) => one.from === move.from && one.to === move.to);
    if (!held) into.moves = [...into.moves, move];
    else Object.assign(held, { count: held.count + move.count, hidden: held.hidden + move.hidden, papers: [...held.papers, ...move.papers].slice(0, PREVIEW_PAPERS) });
  }
  for (const [id, one] of Object.entries(page.joining)) Object.assign(into.joining, { [id]: one.reads === undefined ? { dealt: (into.joining[id]?.dealt ?? 0) + (one.dealt ?? 0) } : { reads: (into.joining[id]?.reads ?? 0) + one.reads } });
  for (const [id, one] of Object.entries(page.models)) Object.assign(into.models, { [id]: { ahead: (into.models[id]?.ahead ?? 0) + one.ahead, atOnce: (into.models[id]?.atOnce ?? 0) + one.atOnce } });
  for (const [id, one] of Object.entries(page.leaving)) {
    const held = into.leaving[id] ?? { ...one, unvoted: 0, voted: 0, settled: 0, waiting: 0, to: [] };
    Object.assign(into.leaving, { [id]: { cast: held.cast, unvoted: held.unvoted + one.unvoted, voted: held.voted + one.voted, settled: held.settled + one.settled, waiting: held.waiting + one.waiting, to: [...new Set([...held.to, ...one.to])] } });
  }
  for (const [id, more] of Object.entries(read.loads)) Object.assign(loads, { [id]: (loads[id] ?? 0) + more });
}

/**
 * Counts what a change to one of the workspace's screenings would do, before it is made, for the change as
 * screening/settings:save takes it: how many papers move from one result to another, with the first of each by name,
 * what each reviewer the change adds gets, what becomes of the papers of one it takes off, what the models read at
 * once, and how many settled papers would move if they were checked again. Nothing is changed.
 */
export const preview = workspaceAction({
  args: { jobId: v.id("screeningJobs"), change: changeValidator },
  returns: previewValidator,
  // Typed here: the generated API's types depend on this module, so inference would loop.
  handler: async (ctx, { userId, workspaceId }, { jobId, change }): Promise<Preview> => {
    const asked = { userId, workspaceId, jobId, change };
    const base: Start = await ctx.runQuery(internal.screening.effects.start, asked);
    const counted: Preview = { ...nothing(), total: base.total, removed: base.removed, included: base.included, leaving: Object.fromEntries(Object.entries(base.cast).map(([id, cast]) => [id, { cast, unvoted: 0, voted: 0, to: [], settled: 0, waiting: 0 }])) };
    const loads: Record<string, number> = {};
    // The papers still open are settled again under the change. The settled ones are looked at only where the change can move them: a check of them, or votes thrown out.
    // Each result is its own range of papers, and each result is cut by the papers' places into slices of about the same size: every slice is counted side by side, a page after a page within one, so a screening ten times larger takes about as long while it has slices to spare.
    // ponytail: one action reads every page while the dialog waits, SLICES at a time: a screening of 100,000 papers is about 60 steps a slice. A count kept in a table and carried on by scheduled steps is the upgrade if a screening grows past that.
    // The first slice has no floor, so a paper with no place is counted in it, and the last has no ceiling.
    const slices: Array<{ from?: number; to?: number }> = Array.from({ length: SLICES }, (_, at) => ({ ...(at ? { from: Math.ceil((at * base.places) / SLICES) } : {}), ...(at < SLICES - 1 ? { to: Math.ceil(((at + 1) * base.places) / SLICES) } : {}) }));
    const through = (result: Result, recheck: boolean, each: (read: Step) => void) =>
      Promise.all(slices.map(async (slice) => {
        let cursor: string | null = null;
        do {
          const read: Step = await ctx.runQuery(internal.screening.effects.step, { ...asked, result, cursor, recheck, slice });
          each(read);
          cursor = read.cursor;
        } while (cursor);
      }));
    await Promise.all([
      ...(["waiting", "conflict", ...(change.recheck || base.discards ? SETTLED : [])] as const).map((result) => through(result, change.recheck === true, (read) => add(counted, loads, read))),
      // How many settled papers the change would move if they were checked again: what it holds back, and what asking for the check lets go.
      ...(base.decides && !change.recheck ? SETTLED : []).map((result) => through(result, true, (read) => { counted.again += read.counted.moves.reduce((sum, move) => sum + move.count, 0); })),
    ]);
    const papers = Object.entries(base.dealt).map(([id, dealt]) => Math.max(0, dealt + (loads[id] ?? 0)));
    return { ...counted, moves: [...counted.moves].sort((a, b) => b.count - a.count), ...(papers.length ? { loads: { least: Math.min(...papers), most: Math.max(...papers) } } : {}) };
  },
});
