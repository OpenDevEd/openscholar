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
import { readsPdfs } from "@/lib/assistant/files";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { longestPdfs, pdfsFor, pricingOf, screeningPaperCredits, screeningPdfsCredits, type Pdfs } from "@/lib/pricing/estimate";
import { modelsProgress, twinsNamed, type Answer } from "@/lib/screening/rules";
import { inWorkspace, useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";
import type { useTranslations } from "next-intl";
import { DAY, GROWS, baseTaken, keptOf, modelsOf, paperTotal, peopleOf, refOf, type Criterion, type Decision, type Person, type Result, type Reviewer, type Screening, type Source, type Workspace } from "./data";
import { useWords, type Words } from "./words";

type View = NonNullable<FunctionReturnType<typeof api.screening.view.get>>;
export type Summary = FunctionReturnType<typeof api.screening.view.list>["page"][number];

/**
 * What a model costs for one paper, in credits: its price for the tokens that call takes at most, as the real estimate
 * works it out. A model left at its own effort is priced at that effort, so picking it, which names that effort, changes
 * nothing, and a lower effort never costs more than the default.
 */
export function paperCredits(model: Pick<MapModel, "inputPricePerMillion" | "outputPricePerMillion"> & { effort?: string; defaultEffort?: string }) {
  return screeningPaperCredits(pricingOf(model), model.effort ?? model.defaultEffort);
}
type Priced = Pick<MapModel, "inputPricePerMillion" | "outputPricePerMillion" | "longPrompt" | "inputs" | "contextLength"> & { effort?: string; defaultEffort?: string };
/** The papers of a screening that are screened as their own PDF, by length (lib/pricing/estimate.ts `Pdfs`). */
export function pdfsOf(sources: Source[]): Pdfs {
  const spread: NonNullable<Pdfs["spread"]> = {};
  let [papers, pages] = [0, 0];
  for (const { read } of sources) {
    papers += read?.filed ?? 0;
    pages += read?.filePages ?? 0;
    for (const [band, held] of Object.entries(read?.fileSpread ?? {})) spread[band] = { papers: (spread[band]?.papers ?? 0) + held.papers, pages: (spread[band]?.pages ?? 0) + held.pages, ...(held.most || spread[band]?.most ? { most: Math.max(held.most ?? 0, spread[band]?.most ?? 0) } : {}) };
  }
  return { papers, pages, spread };
}
/** Whether a model takes a PDF as a file. */
export const takesFiles = (model: Pick<MapModel, "inputs">) => readsPdfs(model.inputs);
/** Of those, the ones a model is given: the server's own rule (convex/screening/dealing.ts `teamFor`), by what the model takes and holds. `sure` for a warning, without it for a cost (lib/pricing/estimate.ts `pdfsFor`). */
export const pdfsGiven = (model: Pick<MapModel, "inputs" | "contextLength">, pdfs: Pdfs, sure = false) => pdfsFor({ files: takesFiles(model), ...(model.contextLength === undefined ? {} : { room: model.contextLength }) }, pdfs, sure);
/** How many of them it is not given, and why: it takes no file, or they are longer than one call to it holds. */
export function pdfsMissed(model: Pick<MapModel, "inputs" | "contextLength">, pdfs: Pdfs) {
  const papers = pdfs.papers - pdfsGiven(model, pdfs, true).papers;
  return { papers, why: takesFiles(model) ? ("long" as const) : ("text" as const) };
}
/**
 * The papers that are only a PDF none of a screening's reviewers can read. With a person on it there are none:
 * people read every paper. With models alone, such a paper gets no place, and waits for a vote nobody casts.
 */
export function unreadPdfs(screening: Pick<Screening, "reviewers" | "sources">) {
  // Someone invited by email reads them once they join.
  if (peopleOf(screening).length) return 0;
  const models = modelsOf(screening).filter((one) => one.model);
  return models.length ? Math.min(...models.map((one) => pdfsMissed(one.model!, pdfsOf(screening.sources)).papers)) : 0;
}
/** The papers of a screening a model is given: all of them, less the ones that are only a PDF it can't read. */
export const readableBy = (model: Pick<MapModel, "inputs" | "contextLength">, papers: number, pdfs: Pdfs) => Math.max(0, papers - (pdfs.papers - pdfsGiven(model, pdfs).papers));
/**
 * What a model's reading of `ahead` of a screening's papers costs at most. A paper read as its PDF costs by the
 * page, far more than one read as an abstract, and nobody knows which papers are still ahead: the PDFs it is
 * given are taken to be among them, the longest first. Every page that prices a model's reading does it with
 * this one sum, or with `readingOf`.
 */
export function readingCredits(model: Priced, ahead: number, pdfs: Pdfs) {
  const filed = longestPdfs(pdfsGiven(model, pdfs), ahead);
  return paperCredits(model) * Math.max(0, ahead - filed.papers) + pdfReadingCredits(model, ahead, pdfs);
}
/** The part of that which is the papers read as their PDFs. */
export function pdfReadingCredits(model: Priced, ahead: number, pdfs: Pdfs) {
  const filed = longestPdfs(pdfsGiven(model, pdfs), ahead);
  return filed.papers ? screeningPdfsCredits(pricingOf(model), filed, model.effort ?? model.defaultEffort) : 0;
}
/** What `count` of one screening's papers cost a model at most. */
export const readingOf = (screening: Pick<Screening, "sources">, model: Priced, count: number) => readingCredits(model, count, pdfsOf(screening.sources));
/** What a model charges to read one paper, as every page says it. */
export const perPaper = ({ words, t }: { words: Words; t: ReturnType<typeof useTranslations<"screening.list">> }, model: Pick<MapModel, "inputPricePerMillion" | "outputPricePerMillion">) => t("perPaper", { credits: words.creditsOf(paperCredits(model)) });

/**
 * What a screening's models are doing, worked out on the server in one place, so the list's row, the frame's notice,
 * the Overview's chip and each model's row never say different things. Null where its models have no paper left to read.
 */
export type ModelsState = "checking" | "gathering" | "paused" | "credits" | "waiting" | "reading";

/** A screening's reviewers as its pages read them, named in the reader's language: one model at two efforts says each effort, and someone whose account is gone is said so. */
export const toReviewers = (rows: Summary["reviewers"], words: Pick<Words, "modelAtEffort" | "person">): Reviewer[] => twinsNamed(rows.map(toReviewer), (model) => model.id, words.modelAtEffort).map((one) => (one.kind === "person" ? { ...one, name: words.person(one.name) } : one));
/** One of them, from the server's row. A model has its own name here: the server's says an effort in English where two share a model. */
function toReviewer(row: Summary["reviewers"][number]): Reviewer {
  const { dealt, cast, include, maybe, exclude, failed, waiting, closed, spent, missed } = row;
  return {
    id: row.id,
    row: row.row,
    kind: row.kind,
    name: row.model ? stripProviderPrefix(row.model.name) : row.name,
    ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
    ...(row.model ? { model: { _id: row.model._id, id: row.model.modelId, name: stripProviderPrefix(row.model.name), inputPricePerMillion: row.model.inputPricePerMillion, outputPricePerMillion: row.model.outputPricePerMillion, ...(row.model.longPrompt ? { longPrompt: row.model.longPrompt } : {}), ...(row.model.contextLength === undefined ? {} : { contextLength: row.model.contextLength }), ...(row.model.effort ? { effort: row.model.effort } : {}), /* What it takes besides text, as far as a screening asks: a file. */ inputs: row.model.files ? ["file"] : [] } } : {}),
    ...(row.guest ? { guest: true } : {}),
    addedAt: row.addedAt,
    ...(row.left === undefined ? {} : { left: row.left }),
    ...(row.discarded === undefined ? {} : { discarded: row.discarded }),
    ...(row.reminded === undefined ? {} : { reminded: row.reminded }),
    tally: { dealt, cast, include, maybe, exclude, failed, waiting, closed, spent, missed, ...(row.kept ? { kept: true } : {}) },
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
    read: { state: source.state, ...(source.failure ? { failure: source.failure } : {}), read: source.read, taken: source.taken, duplicates: source.duplicates, left: source.left, bare: source.bare, filed: source.filed, filePages: source.filePages, ...(source.fileSpread ? { fileSpread: source.fileSpread } : {}), ...(source.capped ? { capped: true } : {}), ...(source.checkedAt === undefined ? {} : { checkedAt: source.checkedAt }), ...(source.removedAt === undefined ? {} : { removedAt: source.removedAt }) },
    addedAt: source.addedAt,
  };
}

/** Reviewers as a file names them, in English: someone whose account is gone as the server says it, and one model at two efforts by each effort. */
const FILE_NAMES: Pick<Words, "modelAtEffort" | "person"> = { person: (name) => name, modelAtEffort: (name, effort) => `${name}, ${effort} effort` };

/** The screening in the shape its pages share. */
function toScreening(view: View, words: Pick<Words, "modelAtEffort" | "person">): Screening {
  const criteria: Criterion[] = view.criteria.map(({ key, text, short, must, note, terms, addedAt }) => ({ key, text, short, must, terms, addedAt, ...(note ? { note } : {}) }));
  const people: Record<string, Person> = { [view.createdBy.id]: { ...view.createdBy, name: words.person(view.createdBy.name) }, [view.resolver.id]: { ...view.resolver, name: words.person(view.resolver.name) } };
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
    reviewers: toReviewers(view.reviewers, words),
    rule: { each: view.each === "all" ? "all" : `${view.each}`, settle: view.settle, resolver: view.resolver.id, blind: view.blind, models: view.modelVotes },
    scoring: { points: Object.fromEntries(view.criteria.map((criterion) => [criterion.key, [criterion.points.yes, criterion.points.no, criterion.points.unclear] as [number, number, number]])), stars: view.stars ?? [] },
    destination: { kind: view.destination.kind, name: view.destination.name ?? "", ...(view.destination.collectionId ? { collection: view.destination.collectionId } : {}), ...(view.destination.libraryId ? { community: { libraryId: view.destination.libraryId, collection: view.destination.libraryCollection ?? "", private: true, requestId: "" } } : {}), prune: view.destination.prune, ...(view.destination.problem ? { problem: view.destination.problem } : {}), ...(view.destination.pruneProblem ? { pruneProblem: view.destination.pruneProblem } : {}) },
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
  const words = useWords();
  const screening = useMemo(() => (view ? toScreening(view, words) : null), [view, words]);
  // The same screening with its reviewers named as a file names them: a file's words are English whoever takes it out (./export.ts).
  const filed = useMemo(() => (view ? toScreening(view, FILE_NAMES) : null), [view]);
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
  const setEmails = useWorkspaceMutation(api.screening.notices.setEmails);
  const retry = useWorkspaceMutation(api.screening.reviewers.retry);
  const remind = useWorkspaceMutation(api.screening.reviewers.remind);
  const move = useWorkspaceMutation(api.screening.reviewers.move);
  const takeOff = useWorkspaceMutation(api.screening.reviewers.remove);
  if (view === undefined) return undefined;
  if (!view || !screening || !filed) return null;
  const models = screening.reviewers.filter((one) => one.kind === "model" && !one.left);
  const reading = models.filter((model) => (model.tally?.waiting ?? 0) > 0);
  return {
    screening,
    filed,
    counts: view.counts as Record<Result, number>,
    total: view.total,
    me: view.me as string,
    /** Whether the person looking votes here, may settle a split, and may change the screening. */
    isReviewer: view.isReviewer,
    canResolve: view.canResolve,
    /** How the others voted is kept from the person looking (convex/screening/view.ts `keepsVotes`). */
    keepsVotes: view.keeps,
    /** Its workspace's members change it. Someone it is shared with from outside votes or looks. */
    canChange: view.member,
    /** The person's place on it where they are a guest. */
    guest: view.guest ?? null,
    /** Its papers are still being fetched from its sources: how many are in, of how many its sources promise where every one of them has been counted. */
    gathering: view.gathering?.first ? { done: view.gathering.done, of: Math.max(view.gathering.done, screening.sources.reduce((sum, source) => sum + (source.read?.state === "done" ? keptOf(source) : baseTaken(source)), 0)) } : null,
    /** The screening whose models read before this one's, and how far they have read. */
    waitingFor: view.models === "waiting" && view.ahead ? view.ahead : null,
    /** The last check that brought papers: how many, and how many of them wait for the person looking. */
    latest: view.latest ?? null,
    /** How many people it is shared with from outside its workspace. */
    guests: view.guests,
    /** Whoever was invited by email to vote on it and has yet to answer, for its workspace's members. */
    invited: view.invited ?? [],
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
    /** The papers its workspace's models read at once. */
    atOnce: view.atOnce,
    spent: (model: Reviewer) => model.tally?.spent ?? 0,
    /** The most a model can come to: what it has cost, and the papers it has still to read. */
    most: (model: Reviewer) => (model.tally?.spent ?? 0) + (model.model ? readingOf(screening, model.model, model.tally?.waiting ?? 0) : 0),
    /** What sending a model back to the papers it couldn't read comes to, and how far the workspace's credits fall short of it. */
    retryOf: (model: Reviewer) => {
      const papers = model.tally?.failed ?? 0;
      const cost = model.model ? readingOf(screening, model.model, papers) : 0;
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
    /** Whether the screening emails the person looking, and their own switch for it. */
    emails: view.emails,
    setEmails: (on: boolean) => setEmails({ jobId, on }),
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

/** How far these models have read, the one furthest behind (lib/screening/rules.ts `modelsProgress`): where none has a paper left, all of `total`. */
export const modelsRead = (models: Reviewer[], total: number) => modelsProgress(models.flatMap((model) => model.tally ?? [])) ?? { done: total, of: total };
