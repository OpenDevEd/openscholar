// What a screening's pages share: its shape as they read it, the words every page uses for the same
// thing, and what follows from its settings alone. The rules that settle a paper are in
// lib/screening/rules.ts, and the server applies them (convex/screening/settling.ts): nothing here
// works out a vote or a result.

import type { FunctionReturnType } from "convex/server";
import type { MapModel } from "@/components/settings/model-map";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DECISIONS, OTHER_REASONS as OTHER_KEYS, RESULTS, SHORT_NAME_LENGTH, SOMEONE, defaultStars, hash, kappa, modelKey as reviewerKey, nextResolver, readersFor, scoreOf, shortOf, twinsNamed, type Criterion as SharedCriterion, type Decision, type Result, type Rule as SharedRule } from "@/lib/screening/rules";

export { DECISIONS, RESULTS, SHORT_NAME_LENGTH, hash, shortOf };
export type { Decision, Result };
export const DECISION_LABEL: Record<Decision, string> = { include: "Include", maybe: "Maybe", exclude: "Exclude" };
export const RESULT_LABEL: Record<Result, string> = { include: "Included", maybe: "Maybe", exclude: "Excluded", conflict: "In conflict", waiting: "Waiting for votes" };

// ── People and models ────────────────────────────────────────────────────────────────────────────

export type Person = { id: string; name: string; imageUrl?: string; guest?: boolean };
/** The name someone is called by in a line of text or a narrow column. */
export const firstName = (name: string) => name.split(" ")[0]!;
export { SOMEONE };
/** A reviewer's name where there is little room: a person's first name, and a model's whole name, since its first word alone only names its maker. */
export const shortName = (reviewer: { kind: "person" | "model"; name: string; email?: string }) => (reviewer.kind === "person" && !reviewer.email ? firstName(reviewer.name) : reviewer.name);
/** A name as part of a file's name or an address. */
export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A number as people read it: "1,204". */
export const num = (n: number) => n.toLocaleString("en-GB");
/** A small number as a word at the start of a sentence: "Three of the 5 reviewers". */
export const numberWord = (n: number) => ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"][n - 1] ?? num(n);
/** A count with its noun: "1 paper", "1,204 papers". */
export const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
/** Names as a phrase: "A", "A and B", "A, B and C". */
export const listed = (names: string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** The workspace a screening is in, as its tag draws it and as its credits are counted. */
export type Workspace = { id: string; kind: "organization" | "personal"; name: string; slug?: string; colour?: string; imageUrl?: string };
/** A workspace as its tile draws it. */
export const lookOf = (workspace: Workspace) => ({ kind: workspace.kind, name: workspace.name, imageUrl: workspace.imageUrl, colour: workspace.colour, workspaceId: workspace.id });

/** A reviewer's counts, kept by the server: papers given to them, the ones voted on by how, the ones a model couldn't read, the ones that still wait, and what a model has cost. */
export type Tally = { dealt: number; cast: number; include: number; maybe: number; exclude: number; failed: number; waiting: number; /** Their papers settled without their vote. */ closed: number; spent: number; /** The papers the screening included that they voted to exclude. */ missed: number; /** How they voted is kept from whoever looks, who still has papers to vote on: `include`, `maybe`, `exclude` and `missed` say nothing. */ kept?: boolean };

/**
 * Someone or something that votes: a person, a person invited by email who has no account yet, or a
 * model at one reasoning effort. `id` is what a vote, the rule or a link names them by: a person's
 * account, an address as `invite:<address>`, a model's row. One not saved yet has no `row`. A
 * reviewer taken off a screening (`left`) keeps the votes they cast, and those go on counting, unless
 * whoever took them off asked for them to be thrown out (`discarded`).
 */
export type Reviewer = {
  id: string;
  row?: Id<"screeningReviewers">;
  kind: "person" | "model";
  name: string;
  imageUrl?: string;
  email?: string;
  model?: MapModel;
  /** From outside the screening's workspace. */
  guest?: boolean;
  addedAt: number;
  left?: number;
  discarded?: number;
  /** When the person was last sent a reminder. */
  reminded?: number;
  tally?: Tally;
};
export const personReviewer = (person: Person, addedAt: number): Reviewer => ({ id: person.id, kind: "person", name: person.name, imageUrl: person.imageUrl, addedAt, ...(person.guest ? { guest: true } : {}) });
export const invitedReviewer = (email: string, addedAt: number): Reviewer => ({ id: `invite:${email}`, kind: "person", name: email, email, addedAt, guest: true });
/** A model on a draft, before its row exists: named by its slug and effort, which is what makes it one reviewer. */
export const modelKey = (model: Pick<MapModel, "id" | "effort">) => reviewerKey(model.id, model.effort);
export const modelReviewer = (model: MapModel, addedAt: number): Reviewer => ({ id: modelKey(model), kind: "model", name: model.name, model, addedAt });
/** A screening's reviewers as its pages name them before a save has: two of one model each say their effort, as the server names them once it has them (lib/screening/rules.ts `twinsNamed`). */
export const withTwins = <S extends Pick<Screening, "reviewers">>(screening: S): S => ({ ...screening, reviewers: twinsNamed(screening.reviewers, (model) => model.id) });

// ── Criteria, sources and the rule ───────────────────────────────────────────────────────────────

/** A criterion as the pages hold it: the shared one (lib/screening/rules.ts), with its points kept apart in the screening's scoring. */
export type Criterion = Omit<SharedCriterion, "points">;

export type SourceKind = "search" | "collection" | "saved" | "screening" | "evidenceLibrary" | "zotero" | "upload" | "pdf" | "dois";
/** What the server reads a source from (convex/screening/validators.ts `sourceSetValidator`). A source picked in the form carries it from then on. */
export type SourceSet =
  | { kind: "search"; searchId: string }
  | { kind: "collection"; collectionId: Id<"collections"> }
  | { kind: "saved" }
  | { kind: "screening"; jobId: Id<"screeningJobs"> }
  | { kind: "evidenceLibrary"; libraryId: Id<"evidenceLibraries">; source: unknown }
  | { kind: "zotero"; collectionKey?: string; groupId?: string; deep?: boolean }
  | { kind: "upload"; file: Id<"_storage">; columns?: Record<string, string> }
  | { kind: "pdf"; batch: string }
  | { kind: "dois"; file: Id<"_storage"> };
/** What tells one source from another where two share a name: the thing it reads. A source the form offers and one the screening already has are the same source where this is the same. */
export const refOf = (set: SourceSet) =>
  set.kind === "search" ? `search:${set.searchId}`
  : set.kind === "collection" ? `collection:${set.collectionId}`
  : set.kind === "screening" ? `screening:${set.jobId}`
  : set.kind === "zotero" ? `zotero:${set.groupId ?? ""}:${set.collectionKey ?? ""}`
  : set.kind === "saved" ? "saved"
  : undefined;
/** How a source's reading stands on the server, once the screening exists: what was read of it, taken, merged with another source's and left out. */
export type SourceRead = { state: "waiting" | "reading" | "done" | "failed"; failure?: string; read: number; taken: number; duplicates: number; left: number; /** Of the ones left out, how many for having no abstract. */ bare: number; /** Of the ones taken, how many are screened as their own PDF, and the pages those have. */ filed: number; filePages: number; /** Those by length (lib/pricing/estimate.ts `Pdfs`). */ fileSpread?: Record<string, { papers: number; pages: number; most?: number }>; checkedAt?: number; removedAt?: number ; /** Its reading stopped at the most papers the workspace's plan gives one screening. */ capped?: boolean };
/** Papers from one place. `total` is what it holds, `range` the ones taken, `duplicates` how many of those another source already brought. */
export type Source = {
  id: string;
  kind: SourceKind;
  name: string;
  detail: string;
  total: number;
  scope: "all" | "range";
  range: [number, number];
  duplicates: number;
  set?: SourceSet;
  read?: SourceRead;
  facts?: string[];
  /** A search's filters, which tell two searches for the same words apart. */
  filters?: string[];
  /** The questions a search's own page screens with, which its screening can take as criteria. */
  questions?: string[];
  /** What each later check found in it: `total` counts these too. */
  updates?: Array<{ at: number; added: number; duplicates: number }>;
  addedAt: number;
  /** The thing it reads, where two can share a name: a Zotero library or one of its collections, a pasted list. */
  ref?: string;
  /** What it held and the screening doesn't take, each with why, where the form itself read them. */
  left?: LeftOut[];
  /** How many of the papers it held have no abstract, where they aren't named in `left`. `total` counts none of them. */
  bare?: number;
};
/** What finds the words the criteria mark in a text, each with whatever ending the text gives it ("programme" marks "programmes" too). Splitting a text by it leaves the marked words at the odd places. Null with no word to find. */
export function termsPattern(terms: string[]) {
  const words = [...new Set(terms)].filter(Boolean).sort((a, b) => b.length - a.length);
  return words.length ? new RegExp(`\\b((?:${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\w*)`, "gi") : null;
}

/** Why a paper that was found isn't screened. */
export const NO_ABSTRACT = "No abstract";
/** How many things a source held that the screening doesn't take. */
export const leftOf = (source: Source) => source.read?.left ?? (source.left?.length ?? 0) + (source.bare ?? 0);
/** How many of those are papers with no abstract. */
export const bareOf = (source: Source) => source.read?.bare ?? (source.bare ?? 0) + (source.left ?? []).filter((one) => one.why === NO_ABSTRACT).length;
export const leftTotal = (sources: Source[]) => sources.reduce((sum, source) => sum + leftOf(source), 0);
/** Something a source held that isn't screened: a record with no title, a DOI that isn't found, a file with nothing to read. */
export type LeftOut = { name: string; why: string };
/** Sources that gain papers over time, which a living screening checks again. A file or a pasted list holds what it held. */
export const GROWS: SourceKind[] = ["search", "collection", "saved", "screening", "evidenceLibrary", "zotero"];
/** Sources whose papers can come with no abstract and their PDF, which a model is sent whole and charges for by the page. */
export const bringsPdfs = (sources: Source[]) => sources.some((source) => (source.kind === "zotero" || source.kind === "pdf") && source.read?.removedAt === undefined);
export const grown = (source: Source) => (source.updates ?? []).reduce((sum, update) => sum + update.added, 0);
/** What a source held when it was added, before any check found more. */
export const baseTotal = (source: Source) => source.total - grown(source);
/** The papers taken from what it held at first: all of them, or a range. */
export const baseTaken = (source: Source) => (source.scope === "all" ? baseTotal(source) : Math.max(0, Math.min(source.range[1], baseTotal(source)) - source.range[0] + 1));
/** What a source brought before duplicates were merged: as the server read it, or as its range promises before it is read. */
export const taken = (source: Source) => (source.read ? source.read.taken + source.read.duplicates : baseTaken(source) + grown(source));
export const keptOf = (source: Source) => (source.read ? source.read.taken : Math.max(0, baseTaken(source) - Math.min(source.duplicates, baseTaken(source))) + (source.updates ?? []).reduce((sum, update) => sum + update.added - update.duplicates, 0));
export const paperTotal = (sources: Source[]) => sources.reduce((sum, source) => sum + keptOf(source), 0);
/** What a screening's sources brought before duplicates were merged: the first count of its flow diagram. */
export const foundTotal = (sources: Source[]) => sources.reduce((sum, source) => sum + taken(source), 0);
/** What was removed before screening, named the same on the Overview and in the flow diagram. */
export const REMOVED_LABEL = { merged: "Duplicates merged", bare: "No abstract", unread: "Could not be read or found" } as const;
/** What its sources held that it doesn't screen: what they left out, how much of that for having no abstract, and the duplicates merged. One count for the progress line and the flow. */
export function removedOf(sources: Source[]) {
  const left = leftTotal(sources);
  return { left, bare: sources.reduce((sum, source) => sum + bareOf(source), 0), merged: foundTotal(sources) - paperTotal(sources) };
}

/** The rule as the pages hold it: the shared one (lib/screening/rules.ts), with how many people read each paper as the text a control holds. */
export type Rule = Omit<SharedRule, "each"> & { each: `${number}` | "all" };
/** What each answer to a criterion is worth, yes, no and unclear, and the points each star starts at. Points only make stars: no vote follows from them. */
export type Scoring = { points: Record<string, [number, number, number]>; stars: number[] };
export type Destination = { kind: "none" | "new" | "collection" | "community"; name: string; collection?: string; prune: boolean; /** In a community: which one, and the collection of the person's there, or a new one of theirs to make (`collection: "new"`). */ community?: { libraryId: string; collection: string; private: boolean; requestId: string } };

/** Why a paper is excluded when no criterion is the reason: shown after the criteria in the list of reasons. */
/** Each names its reason on a chip, a count or a file, where no note stands beside it. The row a reason is picked from says where the other reason is written. */
const OTHER_LABEL: Record<(typeof OTHER_KEYS)[number], string> = { duplicate: "A duplicate of another paper", other: "Another reason" };
const OTHER_REASONS: Array<{ key: string; label: string }> = OTHER_KEYS.map((key) => ({ key, label: OTHER_LABEL[key] }));
/** Whether someone wrote a criterion's short name. One nobody wrote is its question cut short, which names nothing: the question stands in for it. */
export const isNamed = (criterion: Pick<Criterion, "short" | "text">) => criterion.short !== shortOf(criterion.text);
/** A criterion as a line names it: the name someone wrote, or else its question. Every sentence, chip and file that names one takes it from here, in whichever language. */
export const criterionLabel = (criterion: Pick<Criterion, "short" | "text">) => (isNamed(criterion) ? criterion.short : criterion.text.replace(/[?.]$/, ""));
/** A reason in words: the criterion as a line names it, or one of the others. */
export const reasonLabel = (key: string, criteria: Criterion[]) => { const criterion = criteria.find((one) => one.key === key); return criterion ? criterionLabel(criterion) : OTHER_REASONS.find((one) => one.key === key)?.label ?? key; };
/**
 * A reason for excluding in words, the same on a page, in a tooltip and in a file: the criterion that wasn't met,
 * by the name someone gave it or by its question, or one of the other reasons. On a page it is drawn, by `Reason`.
 */
export const failedLabel = (key: string, criteria: Criterion[]) => {
  const criterion = criteria.find((one) => one.key === key);
  return criterion ? (isNamed(criterion) ? `${criterion.short} not met` : `Not met: ${criterionLabel(criterion)}`) : reasonLabel(key, criteria);
};
/**
 * The question a criterion's name stands for, where what a line shows of it isn't already the question's own words:
 * its short name in a column, or its label (`criterionLabel`) in a sentence or a chip.
 */
export const questionOf = (key: string, criteria: Criterion[], shown: "short" | "label" = "short") => {
  const criterion = criteria.find((one) => one.key === key);
  return criterion && (shown === "label" ? criterionLabel(criterion) : criterion.short).trim() !== criterion.text.replace(/[?.]$/, "").trim() ? criterion.text : undefined;
};

// ── A screening ──────────────────────────────────────────────────────────────────────────────────

/** A paper as a screening holds it, with where it stands and the votes the person looking may see (convex/screening/paperViews.ts `shown`). */
export type Paper = NonNullable<FunctionReturnType<typeof api.screening.paperViews.paper>>;
/** One reviewer's place on a paper as someone may see it: their vote, that they have yet to vote, that a model couldn't read it, or only that they are on it. */
export type Cast = Paper["cast"][number];
/** A reviewer's vote on a paper. A model's carries how sure it was of each answer and the sentence of the abstract it relied on, counted from 0. */
export type Vote = NonNullable<Cast["vote"]>;
/** A paper's places with who holds each, as the pages draw them. Someone whose vote stands and who the screening no longer lists is still named. */
export const castOf = (screening: Pick<Screening, "reviewers">, paper: Pick<Paper, "cast">) =>
  paper.cast.map((place) => ({ ...place, vote: place.vote, reviewer: screening.reviewers.find((one) => one.id === place.reviewer) ?? ({ id: place.reviewer, kind: "person", name: SOMEONE, addedAt: 0 } satisfies Reviewer) }));
/** A paper's authors, year and journal on one line under its title in a list: the first author alone, and no journal, where a row has little room. */
export const bylineOf = (paper: Pick<Paper, "authors" | "year" | "venue">, short = false) => [short ? paper.authors?.[0] : paper.authors?.join(", "), paper.year, short ? undefined : paper.venue].filter(Boolean).join(", ");
/** Who a paper still waits for: the reviewers on it who have yet to vote. A vote kept from the person looking is a vote cast, and a model that couldn't read the paper has no say in it. */
export const awaitedOn = (screening: Pick<Screening, "reviewers">, paper: Pick<Paper, "cast">) => castOf(screening, paper).filter((one) => !one.vote && !one.failed && !one.hidden).map((one) => one.reviewer);
/** One reviewer's vote on a paper, where the person looking may see it. */
export const voteOn = (paper: Pick<Paper, "cast">, reviewer: string) => paper.cast.find((place) => place.reviewer === reviewer)?.vote;
/** Its reviewers, and whoever was taken off with votes that still count: a result can rest on one of those votes. */
export const votingReviewers = (screening: Pick<Screening, "reviewers">) => screening.reviewers.filter((one) => !one.left || (!one.discarded && (one.tally?.cast ?? 0) > 0));
/** The most points a paper can earn under the screening's scoring. */
export const pointsMax = (screening: Pick<Screening, "criteria" | "scoring">) => scoreOf(screening.criteria.map(({ key }) => { const [yes, no, unclear] = screening.scoring.points[key] ?? [1, 0, 0]; return { key, points: { yes, no, unclear } }; }), [], []).of;
/** How far two reviewers agree, from the server's count of their votes on the papers both voted on, or nothing where they share none. */
export const pairOf = (figures: { pairs: Array<{ a: string; b: string; matrix: number[] }> } | undefined, a: string, b: string) => {
  const held = figures?.pairs.find((pair) => (pair.a === a && pair.b === b) || (pair.a === b && pair.b === a));
  return held ? kappa(held.matrix) : null;
};
/** Where a paper stands, and who settled it where a person did. */
export type Settled = { result: Result; final?: Decision; resolvedBy?: string; note?: string; reason?: string };
/** Where a paper stands, as its own row says it. */
export const settledOf = (paper: Pick<Paper, "result" | "resolved" | "reason">): Settled => ({ result: paper.result, ...(paper.result === "include" || paper.result === "maybe" || paper.result === "exclude" ? { final: paper.result } : {}), ...(paper.resolved ? { resolvedBy: paper.resolved.by, ...(paper.resolved.note ? { note: paper.resolved.note } : {}) } : {}), ...(paper.reason ? { reason: paper.reason } : {}) });
/** One line of a paper's discussion. `to` names the reviewer it asks, who then has a question waiting (`open`) until they write on the paper. */
export type Message = FunctionReturnType<typeof api.screening.discussion.thread>["page"][number];
export type Every = "day" | "week" | "month";
/** The name a screening's own collection of included papers has, unless it is given another. A source made from a screening's included papers carries the same name. */
export const includedIn = (name: string) => `Included in ${name}`;
export const EVERY_LABEL: Record<Every, string> = { day: "Every day", week: "Every week", month: "Every month" };
/** The rule that settles a paper: the name its choice has in the settings, and the same rule said of a screening. One place, so the settings, their summary, the frame's chips and a "?" never name it differently. */
export const SETTLE_LABEL: Record<Rule["settle"], string> = { all: "All agree", most: "Most agree", one: "First vote decides" };

export type Screening = {
  id: Id<"screeningJobs">;
  name: string;
  createdBy: string;
  createdAt: number;
  finishedAt?: number;
  /** The models are held where they are until someone lets them go on. */
  paused?: boolean;
  /** What the review asks, which criteria are written from. */
  question: string;
  sources: Source[];
  criteria: Criterion[];
  reviewers: Reviewer[];
  rule: Rule;
  scoring: Scoring;
  destination: Destination;
  /** People it is shared with who see everything and don't vote. */
  viewers?: Reviewer[];
  /** The workspace it is in. */
  workspace: Workspace;
  /** How many of its papers have arrived, while they are still being fetched from its sources. */
  gathered?: number;
  /** A living screening looks in its sources again on a schedule, and screens only what is new. */
  living?: { every: Every; next: number };
  /** A check under way: how many of the sources it looks in again have answered. */
  checking?: { done: number; of: number; by: string };
  /** Everyone a page may have to name who isn't one of its reviewers: who started it, who settles it, who ran a check. */
  people: Record<string, Person>;
};

/** Someone a screening's pages name: one of its reviewers, or anyone else it knows. */
export const personIn = (screening: Pick<Screening, "reviewers" | "people">, id: string): Person | undefined => screening.people[id] ?? screening.reviewers.find((one) => one.id === id && one.kind === "person");

export const activeReviewers = (screening: Pick<Screening, "reviewers">) => screening.reviewers.filter((reviewer) => !reviewer.left);
/** The people who read a screening's papers, and how many of them each paper goes to. Someone invited by email is dealt no paper until they join, so they are not counted. */
export const readersOf = (screening: Pick<Screening, "reviewers" | "rule">) => {
  const people = screening.reviewers.filter((reviewer) => !reviewer.left && reviewer.kind === "person" && !reviewer.email);
  return { people, each: readersFor(screening.rule.each === "all" ? "all" : Number(screening.rule.each), people.length) };
};
/**
 * A screening as it would be with a reviewer taken off. The conflicts they settled go to whoever the server gives
 * them to, by the same rule (lib/screening/rules.ts `nextResolver`).
 */
export function withoutReviewer(screening: Screening, reviewer: Reviewer, discard: boolean, now: number): Screening {
  const reviewers = screening.reviewers.map((one) => (one.id === reviewer.id ? { ...one, left: now, ...(discard ? { discarded: now } : {}) } : one));
  const people = readersOf({ ...screening, reviewers }).people;
  return { ...screening, reviewers, ...(screening.rule.resolver === reviewer.id ? { rule: { ...screening.rule, resolver: nextResolver(screening.createdBy, people.map((one) => one.id)) } } : {}) };
}
/** Reviewers in the one order every list, row of faces and table shows them: the person looking, then the other people, then the models. Within each, the order they were added in. */
export const inOrder = <T extends Pick<Reviewer, "id" | "kind">>(reviewers: T[], me: string) => {
  const rank = (one: T) => (one.id === me ? 0 : one.kind === "person" ? 1 : 2);
  return [...reviewers].sort((a, b) => rank(a) - rank(b));
};
/** Whether someone settles a screening's conflicts: the one person its rule names, as every page says. */
export const resolves = (screening: Pick<Screening, "rule">, id: string) => screening.rule.resolver === id;
export const nameOn = (screening: Pick<Screening, "reviewers" | "people">, id: string) => screening.reviewers.find((one) => one.id === id)?.name ?? screening.people[id]?.name ?? SOMEONE;
export const peopleOf = (screening: Pick<Screening, "reviewers">) => activeReviewers(screening).filter((reviewer) => reviewer.kind === "person");
export const modelsOf = (screening: Pick<Screening, "reviewers">) => activeReviewers(screening).filter((reviewer) => reviewer.kind === "model");

/** What a reviewer's place on a paper says where no vote stands in it: they have yet to vote, the paper was settled without them, or a model couldn't read it. One wording for the marks, the menus, the legends and the files. */
export const NO_VOTE = { yet: "No vote yet", none: "No vote", failed: "Couldn't read the paper" } as const;

/** The questions on a paper that still wait for their answer: each line put to one reviewer who has written nothing on the paper since. */
export const waitingQuestions = (said: Message[] | undefined) => (said ?? []).filter((line) => line.to && line.open);

export const count = <T,>(list: T[], test: (item: T) => boolean) => list.reduce((n, item) => n + (test(item) ? 1 : 0), 0);

export const DAY = 86_400_000;
/** The rule a new screening starts with, for whoever starts it. */
export const defaultRule = (resolver: string): Rule => ({ each: "2", settle: "all", resolver, blind: "after" });
export const defaultScoring = (criteria: Criterion[]): Scoring => ({ points: Object.fromEntries(criteria.map((c) => [c.key, [1, 0, 0] as [number, number, number]])), stars: defaultStars(criteria.length) });
/** The sources a check looks in again. */
export const growing = (screening: Pick<Screening, "sources">) => screening.sources.filter((source) => GROWS.includes(source.kind) && !source.read?.removedAt);


const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A date as "17 Nov", every month in three letters, with its year only when that isn't this year. */
export const day = (at: number) => {
  const date = new Date(at);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${date.getFullYear() === new Date().getFullYear() ? "" : ` ${date.getFullYear()}`}`;
};
/** A date as a page shows it: how long ago for the last week, the day before that. */
export function ago(at: number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  // Days are counted on the calendar: a vote cast late yesterday was cast yesterday, not "18 h ago".
  const midnight = (time: number) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(now) - midnight(at)) / DAY);
  if (days <= 0) return `${Math.round(minutes / 60)} h ago`;
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return day(at);
}

/** An abstract cut into its sentences, the way a model that names a passage counts them (lib/screening/passages.ts). */
export { sentencesOf } from "@/lib/screening/passages";

/** Where a screening's included papers are saved, by name, or null where they stay in it. The pages and the files both read this. */
export function collectionName(screening: Pick<Screening, "destination" | "name">) {
  const to = screening.destination;
  if (to.kind === "none") return null;
  if (to.kind === "new" || to.community?.collection === "new") return to.name || includedIn(screening.name);
  // A collection there already is, in the workspace or in a community, has the name it has there.
  return to.name || null;
}
