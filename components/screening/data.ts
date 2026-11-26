// What a screening's pages share: its shape as they read it, the words every page uses for the same
// thing, and what follows from its settings alone. The rules that settle a paper are in
// lib/screening/rules.ts, and the server applies them (convex/screening/settling.ts): nothing here
// works out a vote or a result.

import type { FunctionReturnType } from "convex/server";
import type { MapModel } from "@/components/settings/model-map";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DECISIONS, RESULTS, SHORT_NAME_LENGTH, defaultStars, hash, kappa, readersFor, scoreOf, shortOf, type Decision, type Result } from "@/lib/screening/rules";

export { DECISIONS, RESULTS, SHORT_NAME_LENGTH, hash, shortOf };
export type { Decision, Result };
export const DECISION_LABEL: Record<Decision, string> = { include: "Include", maybe: "Maybe", exclude: "Exclude" };
export const RESULT_LABEL: Record<Result, string> = { include: "Included", maybe: "Maybe", exclude: "Excluded", conflict: "In conflict", waiting: "Waiting for votes" };

// ── People and models ────────────────────────────────────────────────────────────────────────────

export type Person = { id: string; name: string; imageUrl?: string; guest?: boolean };
/** What someone who has no vote on a screening is called: a member of its workspace is not a reviewer, someone it is shared with from outside is a viewer. */
export const lookerLabel = (member: boolean) => (member ? "Not a reviewer" : "Viewer");
/** `invited` and `invitedToLook` stand once the invitation is sent. Before that, `toInvite` on a row not saved yet, `toInviteAtStart` on a screening not started yet, and `invites` in the list a person is picked from. */
export const PERSON_SAYS = { invited: "Invited by email, votes once they join", invitedToLook: "Invited by email, sees it once they join", toInvite: "Gets an invitation when you save", toInviteAtStart: "Gets an invitation when you start", invites: "Gets an invitation by email", guest: "From outside this workspace", member: "In this workspace", settles: "Settles conflicts" } as const;
/** Where a person stands to a screening's workspace, as the line under their name. */
export const standsTo = (person: Pick<Person, "guest"> | undefined) => (person?.guest ? PERSON_SAYS.guest : PERSON_SAYS.member);
/** The name someone is called by in a line of text or a narrow column. */
export const firstName = (name: string) => name.split(" ")[0]!;
/** Someone whose account is gone still has a name where their votes are: the one the server gives them. */
export const SOMEONE = "Someone who left";
/** A person as the one looking reads them at the start of a line: "You" for themselves, their name for anyone else. */
export const youOr = (person: { id: string; name: string }, me: string | undefined) => (person.id === me ? "You" : person.name);
/** A reviewer's name where there is little room: a person's first name, and a model's whole name, since its first word alone only names its maker. */
export const shortName = (reviewer: { kind: "person" | "model"; name: string; email?: string }) => (reviewer.kind === "person" && !reviewer.email ? firstName(reviewer.name) : reviewer.name);
/** A name as part of a file's name or an address. */
export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** What someone wrote, quoted: a note with a vote, a paper's title in a line of text. One form everywhere. */
export const inQuotes = (text: string) => `“${text}”`;
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
export type Tally = { dealt: number; cast: number; include: number; maybe: number; exclude: number; failed: number; waiting: number; /** Their papers settled without their vote. */ closed: number; spent: number; /** The papers the screening included that they voted to exclude. */ missed: number };

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
export const modelKey = (model: Pick<MapModel, "id" | "effort">) => `model:${model.id}:${model.effort ?? ""}`;
export const modelReviewer = (model: MapModel, addedAt: number): Reviewer => ({ id: modelKey(model), kind: "model", name: model.name, model, addedAt });

// ── Criteria, sources and the rule ───────────────────────────────────────────────────────────────

export type Criterion = { key: string; text: string; short: string; must: boolean; /** Words the organiser marked, shown in the abstract while a person votes. */ terms: string[]; addedAt: number; /** Guidance for whoever answers it, a person or a model: what counts and what doesn't. */ note?: string };

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
export type SourceRead = { state: "waiting" | "reading" | "done" | "failed"; failure?: string; read: number; taken: number; duplicates: number; left: number; /** Of the ones left out, how many for having no abstract. */ bare: number; /** Of the ones taken, how many are screened as their own PDF, and the pages those have. */ filed: number; filePages: number; checkedAt?: number; removedAt?: number ; /** Its reading stopped at the most papers the workspace's plan gives one screening. */ capped?: boolean };
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
/** Why something a source held isn't screened, in words, by the reason the server kept. */
export const LEFT_WHY = { abstract: NO_ABSTRACT, title: "No title", doi: "No such DOI", record: "No record of it", broken: "Doesn't open" } as const;
/** How many things a source held that the screening doesn't take. */
export const leftOf = (source: Source) => source.read?.left ?? (source.left?.length ?? 0) + (source.bare ?? 0);
/** How many of those are papers with no abstract. */
export const bareOf = (source: Source) => source.read?.bare ?? (source.bare ?? 0) + (source.left ?? []).filter((one) => one.why === NO_ABSTRACT).length;
export const leftTotal = (sources: Source[]) => sources.reduce((sum, source) => sum + leftOf(source), 0);
/** Something a source held that isn't screened: a record with no title, a DOI that isn't found, a file with nothing to read. */
export type LeftOut = { name: string; why: string };
/** How a PDF handed to a screening stands, in words: the index holds its paper, it is screened as the file it is, or it doesn't open. */
export const PDF_STANDS = { known: "In the index", file: "Screened as the PDF", broken: LEFT_WHY.broken, waiting: "Reading it" } as const;
/** Sources that gain papers over time, which a living screening checks again. A file or a pasted list holds what it held. */
export const GROWS: SourceKind[] = ["search", "collection", "saved", "screening", "evidenceLibrary", "zotero"];
export const grown = (source: Source) => (source.updates ?? []).reduce((sum, update) => sum + update.added, 0);
/** What a source held when it was added, before any check found more. */
export const baseTotal = (source: Source) => source.total - grown(source);
/** The papers taken from what it held at first: all of them, or a range. */
const baseTaken = (source: Source) => (source.scope === "all" ? baseTotal(source) : Math.max(0, Math.min(source.range[1], baseTotal(source)) - source.range[0] + 1));
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

export type Rule = {
  /** How many people read each paper: a number, or everyone on the screening, whoever joins later included. */
  each: `${number}` | "all";
  /** When a paper is settled: every reviewer agrees, most of them do, or the first vote decides. */
  settle: "all" | "most" | "one";
  /** Who settles a split. */
  resolver: string;
  /** When people see the other votes on a paper. */
  blind: "after" | "always";
};
/** What each answer to a criterion is worth, yes, no and unclear, and the points each star starts at. Points only make stars: no vote follows from them. */
export type Scoring = { points: Record<string, [number, number, number]>; stars: number[] };
export type Destination = { kind: "none" | "new" | "collection" | "community"; name: string; collection?: string; prune: boolean; /** In a community: which one, and the collection of the person's there, or a new one of theirs to make (`collection: "new"`). */ community?: { libraryId: string; collection: string; private: boolean; requestId: string } };

/** Why a paper is excluded when no criterion is the reason: shown after the criteria in the list of reasons. */
/** Each names its reason on a chip, a count or a file, where no note stands beside it. The row a reason is picked from says where the other reason is written. */
const OTHER_REASONS: Array<{ key: string; label: string }> = [{ key: "duplicate", label: "A duplicate of another paper" }, { key: "other", label: "Another reason" }];
/**
 * What a paper can be excluded for, in groups, the same wherever Exclude asks why: a must-have it fails, any other
 * criterion it fails, or another reason. Each has a key for the keyboard: a criterion its own number, as far as the
 * digits go, and another reason its first letter.
 */
export const excludeGroups = (criteria: Criterion[], many = false) => {
  const keyed = criteria.map((criterion, i) => ({ key: criterion.key, must: criterion.must, hotkey: i < 9 ? String(i + 1) : "" }));
  const [musts, nice] = [keyed.filter((one) => one.must), keyed.filter((one) => !one.must)];
  const others = OTHER_REASONS.map((reason) => ({ key: reason.key, hotkey: reason.key[0]!.toUpperCase() }));
  // Asked of one paper, or of several picked together.
  return [
    { name: many ? "Which must-have do these papers fail?" : "Which must-have does it fail?", list: musts },
    { name: musts.length ? "Or another criterion" : many ? "Which criterion do these papers fail?" : "Which criterion does it fail?", list: nice },
    { name: criteria.length ? "Or another reason" : many ? "Why exclude them?" : "Why exclude it?", list: others },
  ].filter((group) => group.list.length);
};
/** A reason in words: the criterion's short name, or one of the others. */
export const reasonLabel = (key: string, criteria: Criterion[]) => criteria.find((criterion) => criterion.key === key)?.short ?? OTHER_REASONS.find((one) => one.key === key)?.label ?? key;
/** A reason for excluding in words, for a file, a tooltip or a screen reader: the criterion that wasn't met, named as such, or one of the other reasons. On a page it is drawn, by `Reason`. */
export const failedLabel = (key: string, criteria: Criterion[]) => (criteria.some((criterion) => criterion.key === key) ? `${reasonLabel(key, criteria)} not met` : reasonLabel(key, criteria));
/** A criterion nobody could answer, as the reason a paper stands at Maybe, in words. */
export const unclearLabel = (key: string, criteria: Criterion[]) => `${criteria.find((criterion) => criterion.key === key)?.short ?? key} unclear`;
/** The question a short name or a reason stands for, where the name isn't already the question's own words. */
export const questionOf = (key: string, criteria: Criterion[]) => {
  const criterion = criteria.find((one) => one.key === key);
  return criterion && criterion.short !== criterion.text.replace(/[?.]$/, "").trim() ? criterion.text : undefined;
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
/** How many of its papers a model has read: the ones it voted on and the ones it couldn't read. One count for its meter, its row and the frame. */
export const readBy = (tally: Pick<Tally, "cast" | "failed"> | undefined) => (tally?.cast ?? 0) + (tally?.failed ?? 0);
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
/** One thing that happened in a screening, as its activity lists it. */
export type Change = { at: number; /** A person, or SCHEDULE for something that happened by itself. */ by: string; what: string; effect?: string };
export type Every = "day" | "week" | "month";
/** The name a screening's own collection of included papers has, unless it is given another. A source made from a screening's included papers carries the same name. */
export const includedIn = (name: string) => `Included in ${name}`;
export const EVERY_LABEL: Record<Every, string> = { day: "Every day", week: "Every week", month: "Every month" };
/** What a living screening is, in a chip: the word and what it means. */
export const livingSays = (every: Every) => `Living, new papers ${EVERY_LABEL[every].toLowerCase()}`;
/** The rule that settles a paper: the name its choice has in the settings, and the same rule said of a screening. One place, so the settings, their summary, the frame's chips and a "?" never name it differently. */
export const SETTLE_LABEL: Record<Rule["settle"], string> = { all: "All agree", most: "Most agree", one: "First vote decides" };
/** What settles a paper under each rule, said the same wherever it is explained. Under the first two a paper waits until every reviewer given it has voted. */
export const SETTLE_MEANS: Record<Rule["settle"], string> = {
  all: "A paper is settled once every reviewer given it has voted and all of them voted the same way. Any split is a conflict.",
  most: "A paper is settled once every reviewer given it has voted and more than half of them voted the same way. With no such majority it is a conflict.",
  one: "A paper is settled by the first vote on it, so there is never a conflict.",
};
export const SETTLE_SAYS: Record<Rule["settle"], string> = { all: "Settled when all agree", most: "Settled when most agree", one: "Settled by the first vote" };
/** A check of a screening's sources: how many papers it found, and how many of those were new to the screening. */
export type Update = { id?: string; at: number; found: number; added: number; by: string };
/** Who a scheduled check is by: nobody. */
export const SCHEDULE = "schedule";

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
 * A screening as it would be with a reviewer taken off. The conflicts they settled go to whoever started the screening,
 * or failing that the first person still on it, as the server gives them (convex/screening/reviewers.ts `takeOff`).
 * With nobody else on it they stay theirs.
 */
export function withoutReviewer(screening: Screening, reviewer: Reviewer, discard: boolean, now: number): Screening {
  const reviewers = screening.reviewers.map((one) => (one.id === reviewer.id ? { ...one, left: now, ...(discard ? { discarded: now } : {}) } : one));
  const people = readersOf({ ...screening, reviewers }).people;
  const next = screening.rule.resolver === reviewer.id ? (people.find((one) => one.id === screening.createdBy) ?? people[0])?.id : undefined;
  return { ...screening, reviewers, ...(next ? { rule: { ...screening.rule, resolver: next } } : {}) };
}
/** Reviewers in the one order every list, row of faces and table shows them: the person looking, then the other people, then the models. Within each, the order they were added in. */
export const inOrder = <T extends Pick<Reviewer, "id" | "kind">>(reviewers: T[], me: string) => {
  const rank = (one: T) => (one.id === me ? 0 : one.kind === "person" ? 1 : 2);
  return [...reviewers].sort((a, b) => rank(a) - rank(b));
};
/** Whether someone settles a screening's conflicts: the one person its rule names, as every page says. */
export const resolves = (screening: Pick<Screening, "rule">, id: string) => screening.rule.resolver === id;
/** Someone on a screening as the person looking reads them: "you" for themselves, the name for anyone else, or a person's first name where there is little room. */
export const whoIs = (screening: Pick<Screening, "reviewers" | "people">, id: string, me: string, short = false) => (id === me ? "you" : short ? firstName(nameOn(screening, id)) : nameOn(screening, id));
/** Who settles a screening's conflicts, as the start of a sentence about it: "you settle" or "Kwame Mensah settles". */
export const settlerSettles = (screening: Pick<Screening, "reviewers" | "rule" | "people">, me: string) => (screening.rule.resolver === me ? "you settle" : `${nameOn(screening, screening.rule.resolver)} settles`);
export const nameOn = (screening: Pick<Screening, "reviewers" | "people">, id: string) => screening.reviewers.find((one) => one.id === id)?.name ?? screening.people[id]?.name ?? SOMEONE;
export const peopleOf = (screening: Pick<Screening, "reviewers">) => activeReviewers(screening).filter((reviewer) => reviewer.kind === "person");
export const modelsOf = (screening: Pick<Screening, "reviewers">) => activeReviewers(screening).filter((reviewer) => reviewer.kind === "model");

/** What stands where no paper has a result: on a Papers tab and in the Export dialog. "Yet" only while the screening is running. */
export const emptyResult = (result: Result | "all", finished: boolean) => ({ all: "No papers yet", include: finished ? "No paper was included" : "Nothing included yet", maybe: finished ? "No paper was left at Maybe" : "Nothing marked Maybe yet", exclude: finished ? "No paper was excluded" : "Nothing excluded yet", conflict: "No papers in conflict", waiting: "No papers waiting for a vote" })[result];
/** What a reviewer's place on a paper says where no vote stands in it: they have yet to vote, the paper was settled without them, or a model couldn't read it. One wording for the marks, the menus, the legends and the files. */
export const NO_VOTE = { yet: "No vote yet", none: "No vote", failed: "Couldn't read the paper" } as const;
/** The same three in a legend, where there is room to say what each means. */
export const NO_VOTE_SAYS = { yet: NO_VOTE.yet, none: "Paper settled without this vote", failed: "Model couldn't read the paper" } as const;
/** On a lock the person's own vote opens, and nowhere else: a paper that still waits for their vote. */
export const HIDDEN_UNTIL_VOTE = "Hidden until you vote";
/** The rule itself, for a "?" or a legend anyone may read, whether or not they vote: it says what this screening does and to whom. */
export const VOTES_HIDDEN_SAYS = "This screening hides other votes from a reviewer only on papers that still wait for that reviewer's own vote.";

/** The questions on a paper that still wait for their answer: each line put to one reviewer who has written nothing on the paper since. */
export const waitingQuestions = (said: Message[] | undefined) => (said ?? []).filter((line) => line.to && line.open);

export const count = <T,>(list: T[], test: (item: T) => boolean) => list.reduce((n, item) => n + (test(item) ? 1 : 0), 0);

export const DAY = 86_400_000;
/** The rule a new screening starts with, for whoever starts it. */
export const defaultRule = (resolver: string): Rule => ({ each: "2", settle: "all", resolver, blind: "after" });
export const defaultScoring = (criteria: Criterion[]): Scoring => ({ points: Object.fromEntries(criteria.map((c) => [c.key, [1, 0, 0] as [number, number, number]])), stars: defaultStars(criteria.length) });
/** The sources a check looks in again. */
export const growing = (screening: Pick<Screening, "sources">) => screening.sources.filter((source) => GROWS.includes(source.kind) && !source.read?.removedAt);

/** What starting a screening says it began with: its papers and sources, and who screens it. A count of none is left out. */
export const startedSays = (papers: number, sources: number, people: number, models: number) =>
  `${plural(papers, "paper", "papers")} from ${plural(sources, "source", "sources")}, for ${listed([people ? plural(people, "person", "people") : "", models ? plural(models, "model", "models") : ""].filter(Boolean)) || "reviewers still to be added"}`;

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
