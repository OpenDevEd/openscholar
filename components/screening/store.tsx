"use client";

// A screening as its pages read it: one live read of the screening as the person looking sees it,
// turned into the shape the pages share (./data.ts), with what they can do to it. Every page of an
// open screening reads this one, so the frame, the Overview and the settings always agree.

import { useMemo, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { MapModel } from "@/components/settings/model-map";
import { stripProviderPrefix } from "@/lib/ai/model-display";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { screeningPaperCredits } from "@/lib/pricing/estimate";
import type { Answer } from "@/lib/screening/setup";
import { inWorkspace, useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";
import { DAY, GROWS, keptOf, num, readBy, refOf, type Criterion, type Decision, type Person, type Result, type Reviewer, type Screening, type Source, type Workspace } from "./data";

type View = NonNullable<FunctionReturnType<typeof api.screening.view.get>>;
export type Summary = FunctionReturnType<typeof api.screening.view.list>["page"][number];

/** What a model costs for one paper, in credits: its price for the tokens that call takes at most, as the real estimate works it out. */
export function paperCredits(model: Pick<MapModel, "inputPricePerMillion" | "outputPricePerMillion">) {
  return screeningPaperCredits({ input: model.inputPricePerMillion, output: model.outputPricePerMillion });
}
/** Credits as people read them: whole numbers once there are any, and never "0" for something that costs. */
export const credits = (n: number) => (n === 0 ? "0" : n < 10 ? n.toLocaleString("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: n < 1 ? 1 : 0 }) : num(Math.ceil(n)));
/** What a model charges to read one paper, as every page says it. */
export const perPaper = (model: Pick<MapModel, "inputPricePerMillion" | "outputPricePerMillion">) => `${credits(paperCredits(model))} credits a paper`;

/**
 * What a screening's models are doing, worked out on the server in one place, so the list's row, the frame's notice,
 * the Overview's chip and each model's row never say different things. Null where its models have no paper left to read.
 */
export type ModelsState = "checking" | "gathering" | "paused" | "credits" | "waiting" | "reading";

/** A reviewer as the pages read them, from the server's row. */
export function toReviewer(row: Summary["reviewers"][number]): Reviewer {
  const { dealt, cast, include, maybe, exclude, failed, waiting, closed, spent, missed } = row;
  return {
    id: row.id,
    row: row.row,
    kind: row.kind,
    name: row.name,
    ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
    ...(row.model ? { model: { _id: row.model._id, id: row.model.modelId, name: stripProviderPrefix(row.model.name), inputPricePerMillion: row.model.inputPricePerMillion, outputPricePerMillion: row.model.outputPricePerMillion, ...(row.model.effort ? { effort: row.model.effort } : {}) } } : {}),
    ...(row.guest ? { guest: true } : {}),
    addedAt: row.addedAt,
    ...(row.left === undefined ? {} : { left: row.left }),
    ...(row.discarded === undefined ? {} : { discarded: row.discarded }),
    ...(row.reminded === undefined ? {} : { reminded: row.reminded }),
    tally: { dealt, cast, include, maybe, exclude, failed, waiting, closed, spent, missed },
  };
}

const toWorkspace = (workspace: Summary["workspace"]): Workspace => ({ id: workspace.id, kind: workspace.kind, name: workspace.name, ...(workspace.slug ? { slug: workspace.slug } : {}), ...(workspace.imageUrl ? { imageUrl: workspace.imageUrl } : {}), ...(workspace.colour ? { colour: workspace.colour } : {}) });

function toSource(source: View["sources"][number]): Source {
  const total = source.total ?? source.read;
  return {
    id: source.id,
    kind: source.set.kind,
    name: source.name,
    detail: source.detail ?? "",
    ...(source.facts?.length ? { filters: source.facts } : {}),
    total,
    scope: source.first === undefined && source.last === undefined ? "all" : "range",
    range: [source.first ?? 1, source.last ?? total],
    duplicates: source.duplicates,
    set: source.set as Source["set"],
    ...(refOf(source.set as NonNullable<Source["set"]>) ? { ref: refOf(source.set as NonNullable<Source["set"]>) } : {}),
    read: { state: source.state, ...(source.failure ? { failure: source.failure } : {}), read: source.read, taken: source.taken, duplicates: source.duplicates, left: source.left, bare: source.bare, ...(source.capped ? { capped: true } : {}), ...(source.checkedAt === undefined ? {} : { checkedAt: source.checkedAt }), ...(source.removedAt === undefined ? {} : { removedAt: source.removedAt }) },
    addedAt: source.addedAt,
  };
}

/** The screening in the shape its pages share. */
function toScreening(view: View): Screening {
  const criteria: Criterion[] = view.criteria.map(({ key, text, short, must, note, terms, addedAt }) => ({ key, text, short, must, terms, addedAt, ...(note ? { note } : {}) }));
  const people: Record<string, Person> = { [view.createdBy.id]: view.createdBy, [view.resolver.id]: view.resolver };
  const grows = view.sources.filter((source) => source.removedAt === undefined && GROWS.includes(source.set.kind));
  return {
    id: view.id,
    name: view.name,
    createdBy: view.createdBy.id,
    createdAt: view.createdAt,
    ...(view.finishedAt === undefined ? {} : { finishedAt: view.finishedAt }),
    ...(view.paused ? { paused: true } : {}),
    question: view.question ?? "",
    sources: view.sources.filter((source) => source.removedAt === undefined).map(toSource),
    criteria,
    reviewers: view.reviewers.map(toReviewer),
    rule: { each: view.each === "all" ? "all" : `${view.each}`, settle: view.settle, resolver: view.resolver.id, blind: view.blind },
    scoring: { points: Object.fromEntries(view.criteria.map((criterion) => [criterion.key, [criterion.points.yes, criterion.points.no, criterion.points.unclear] as [number, number, number]])), stars: view.stars ?? [] },
    destination: { kind: view.destination.kind, name: view.destination.name ?? "", ...(view.destination.collectionId ? { collection: view.destination.collectionId } : {}), ...(view.destination.libraryId ? { community: { libraryId: view.destination.libraryId, collection: view.destination.libraryCollection ?? "", private: true, requestId: "" } } : {}), prune: view.destination.prune },
    workspace: toWorkspace(view.workspace),
    ...(view.gathering?.first ? { gathered: view.gathering.done } : {}),
    ...(view.living ? { living: view.living } : {}),
    // A check under way: how many of the sources it looks in again have answered.
    ...(view.gathering && !view.gathering.first ? { checking: { done: grows.filter((source) => source.state === "done" || source.state === "failed").length, of: grows.length, by: view.gathering.by ?? "schedule" } } : {}),
    people,
  };
}

/** A vote as a page casts it: a decision, a reason on Exclude, and the answers and note the person gave with it. */
export type Ballot = { decision: Decision; reason?: string; note?: string; answers?: Record<string, Answer> };

/**
 * One screening as the person looking at it sees it: where its papers stand, what is theirs to do, what
 * they may see, and what they can change. Undefined while it is read, null when it is none of theirs.
 */
export function useOpenScreening(id: string) {
  const jobId = id as Id<"screeningJobs">;
  // With no screening named there is none to read: the form that starts a new one asks for the one it copies only where it copies one.
  const view = useProtectedQuery(api.screening.view.get, inWorkspace(useWorkspace(), id ? { jobId } : "skip")).data;
  const screening = useMemo(() => (view ? toScreening(view) : null), [view]);
  const vote = useWorkspaceMutation(api.screening.voting.vote);
  const voteMany = useWorkspaceMutation(api.screening.voting.voteMany);
  const resolve = useWorkspaceMutation(api.screening.voting.resolve);
  const pause = useWorkspaceMutation(api.screening.screenings.pause);
  const resume = useWorkspaceMutation(api.screening.screenings.resume);
  const finish = useWorkspaceMutation(api.screening.screenings.finish);
  const reopen = useWorkspaceMutation(api.screening.screenings.reopen);
  const rename = useWorkspaceMutation(api.screening.screenings.rename);
  const remove = useWorkspaceMutation(api.screening.screenings.remove);
  const check = useWorkspaceMutation(api.screening.living.checkNow);
  const join = useWorkspaceMutation(api.screening.reviewers.joinIn);
  const retry = useWorkspaceMutation(api.screening.reviewers.retry);
  const remind = useWorkspaceMutation(api.screening.reviewers.remind);
  const move = useWorkspaceMutation(api.screening.reviewers.move);
  const takeOff = useWorkspaceMutation(api.screening.reviewers.remove);
  if (view === undefined) return undefined;
  if (!view || !screening) return null;
  const models = screening.reviewers.filter((one) => one.kind === "model" && !one.left);
  const reading = models.filter((model) => (model.tally?.waiting ?? 0) > 0);
  return {
    screening,
    counts: view.counts as Record<Result, number>,
    total: view.total,
    me: view.me as string,
    /** Whether the person looking votes here, may settle a split, and may change the screening. */
    isReviewer: view.isReviewer,
    canResolve: view.canResolve,
    /** Its workspace's members change it. Someone it is shared with from outside votes or looks. */
    canChange: view.member,
    /** The person's place on it where they are a guest. */
    guest: view.guest ?? null,
    /** Its papers are still being fetched from its sources: how many are in, of how many its sources promise where every one of them has been counted. */
    gathering: view.gathering?.first ? { done: view.gathering.done, of: Math.max(view.gathering.done, screening.sources.reduce((sum, source) => sum + (source.read?.state === "done" ? keptOf(source) : Math.max(0, Math.min(source.range[1], source.total) - source.range[0] + 1)), 0)) } : null,
    /** The screening whose models read before this one's, and how far they have read. */
    waitingFor: view.models === "waiting" && view.ahead ? view.ahead : null,
    /** The last check that brought papers: how many, and how many of them wait for the person looking. */
    latest: view.latest ?? null,
    /** How many people it is shared with from outside its workspace. */
    guests: view.guests,
    /** The person's papers to vote on, the screening's papers in conflict, which one person settles and everyone may read, and the papers someone asked them about. */
    toDo: view.forYou,
    conflicts: view.counts.conflict,
    asked: view.asked,
    /** The first paper a question waits on, which "your questions" opens. */
    askedFirst: view.askedFirst,
    /** The last check of its sources, whatever it found. */
    lastCheck: view.lastCheck ?? null,
    /** Votes of theirs that ask for a new one, since a criterion became a must-have. */
    flagged: view.flagged,
    /** The models that still have papers to read. */
    reading,
    outOfCredits: view.models === "credits",
    /** What its models are doing now, or nothing where they have no paper left to read. */
    modelsNow: view.models as ModelsState | null,
    /** The workspace's credits, for its members. */
    wallet: view.credits,
    spent: (model: Reviewer) => model.tally?.spent ?? 0,
    /** The most a model can come to: what it has cost, and the papers it has still to read. */
    most: (model: Reviewer) => (model.tally?.spent ?? 0) + (model.tally?.waiting ?? 0) * (model.model ? paperCredits(model.model) : 0),
    /** What sending a model back to the papers it couldn't read comes to, and how far the workspace's credits fall short of it. */
    retryOf: (model: Reviewer) => {
      const papers = model.tally?.failed ?? 0;
      const cost = model.model ? papers * paperCredits(model.model) : 0;
      return { papers, cost, short: Math.max(0, cost - (view.credits ?? Infinity)) };
    },
    vote: (paperId: Id<"screeningResults">, ballot: Ballot | null) => vote({ jobId, paperId, decision: ballot?.decision ?? null, ...(ballot?.reason ? { reason: ballot.reason } : {}), ...(ballot?.note ? { note: ballot.note } : {}), ...(ballot?.answers ? { answers: ballot.answers } : {}) }),
    voteMany: (paperIds: Id<"screeningResults">[], ballot: Ballot) => voteMany({ jobId, paperIds, decision: ballot.decision, ...(ballot.reason ? { reason: ballot.reason } : {}), ...(ballot.note ? { note: ballot.note } : {}) }),
    resolve: (paperId: Id<"screeningResults">, decision: Decision | null, note?: string, reason?: string) => resolve({ jobId, paperId, decision, ...(note ? { note } : {}), ...(reason ? { reason } : {}) }),
    pause: () => pause({ jobId }),
    resume: () => resume({ jobId }),
    finish: () => finish({ jobId }),
    reopen: () => reopen({ jobId }),
    rename: (name: string) => rename({ jobId, name }),
    remove: () => remove({ jobId }),
    /** Looks in its sources again now, whoever asks: the papers they gained since the last look join the queue. */
    check: () => check({ jobId }),
    /** A member who isn't one of its reviewers takes a share of the papers nobody has got to. */
    join: () => join({ jobId }),
    /** Sends a model back to the papers it couldn't read. */
    retry: (model: Reviewer) => (model.row ? retry({ jobId, reviewerId: model.row }) : Promise.resolve(null)),
    /** Sends a person a reminder by email that papers wait for their vote. */
    remind: (person: Reviewer) => (person.row ? remind({ jobId, reviewerId: person.row }) : Promise.resolve(null)),
    /** Moves papers one person hasn't voted on yet to another. */
    move: (from: Reviewer, to: Reviewer, papers: number) => (from.row && to.row ? move({ jobId, from: from.row, to: to.row, papers }) : Promise.resolve({ moved: 0 })),
    /** Takes a reviewer off. Their votes keep counting unless they are thrown out. */
    takeOff: (reviewer: Reviewer, discard: boolean) => (reviewer.row ? takeOff({ jobId, reviewerId: reviewer.row, ...(discard ? { discard: true } : {}) }) : Promise.resolve(null)),
  };
}
export type Open = NonNullable<ReturnType<typeof useOpenScreening>>;

const HOUR = 3_600_000;
/** How many days of votes set a person's pace. */
export const PACE_DAYS = 3;
/**
 * The figures a screening's overview and its files are drawn from: its excluded papers by reason, its included ones
 * by source, how far each pair of reviewers agrees, and each person's votes of the last days. Undefined while read.
 */
export function useFigures(id: Id<"screeningJobs">) {
  // The time the pace is counted from is taken once, to the hour, so it is the same read for as long as the page is open.
  const [now] = useState(() => Math.floor(Date.now() / HOUR) * HOUR);
  const figures = useProtectedQuery(api.screening.view.figures, inWorkspace(useWorkspace(), { jobId: id, since: now - PACE_DAYS * DAY })).data;
  return { figures: figures ?? undefined, now };
}
export type Figures = NonNullable<ReturnType<typeof useFigures>["figures"]>;

/** How far a screening's models have read: the place of the slowest of them, as the meters show it. */
export const modelsDone = (models: Reviewer[]) => (models.length ? Math.min(...models.map((model) => readBy(model.tally))) : 0);
