import { v, type Infer } from "convex/values";
import { MAX_AUTHORS, MAX_QUESTIONS, MAX_STARS, capped } from "../lib/listCaps";
import { PDF_BANDS } from "../../lib/pricing/estimate";
import { answerSourceValidator } from "../../lib/research/records";
import { sourceMetadataFields } from "../lib/paperMetadata";
import { crossRefsValidator } from "../lib/paperRef";
import { librarySourceValidator } from "../evidenceLibraries/validators";
import { effortValidator, longPromptValidator } from "../aiModelConfig/validators";

/**
 * Screening question snapshot embedded in job records.
 * Simplified from client-side ScreeningQuestion (no id/type -- screening is boolean-only).
 */
export const screeningQuestionValidator = v.object({
  key: v.string(),
  question: v.string(),
});

/** A screening's questions: at most MAX_QUESTIONS. */
export const screeningQuestionsValidator = capped(v.array(screeningQuestionValidator), MAX_QUESTIONS);

/**
 * Per-question scoring rule: maps yes/no/null answers to point values.
 */
export const screeningScoringRuleValidator = v.object({
  questionKey: v.string(),
  yesPoints: v.number(),
  noPoints: v.number(),
  nullPoints: v.number(),
  // A paper not answered yes here is never included, whatever its points.
  required: v.optional(v.boolean()),
});

/**
 * Full scoring configuration embedded in screening jobs.
 * Rules define point values per question, thresholds map total scores to star ratings.
 */
export const screeningScoringConfigValidator = v.object({
  rules: capped(v.array(screeningScoringRuleValidator), MAX_QUESTIONS),
  starThresholds: capped(
    v.array(
      v.object({
        minScore: v.number(),
        stars: v.number(),
      })
    ),
    MAX_STARS,
  ),
  minimumScore: v.optional(v.number()),
});

/** A screened paper's authors, the first MAX_AUTHORS of them. */
export const screeningAuthorsValidator = capped(v.optional(v.array(v.string())), MAX_AUTHORS);

/** A screened paper's answers, one per question. */
export const screeningAnswersValidator = capped(v.optional(v.record(v.string(), v.union(v.boolean(), v.null()))), MAX_QUESTIONS);

export const screeningDecisionSourcesValidator = capped(v.optional(v.record(v.string(), v.object({
  by: answerSourceValidator,
  at: v.optional(v.number()),
}))), MAX_QUESTIONS);
export const screeningConfidencesValidator = capped(v.optional(v.record(v.string(), v.number())), MAX_QUESTIONS);

/**
 * Paper input shape for screening job creation.
 * Snapshot of paper metadata at job creation time.
 */
export const screeningPaperInputValidator = v.object({
  ...sourceMetadataFields,
  /** The paper's key (lib/papers/paper-ref.ts), and what finds it elsewhere. */
  paper: v.string(),
  crossRefs: v.optional(crossRefsValidator),
  title: v.string(),
  abstract: v.optional(v.string()),
  /** The paper's own PDF, handed over by whoever added it, and how many pages it has: what a paper with no abstract is screened on. */
  file: v.optional(v.id("_storage")),
  pages: v.optional(v.number()),
  authors: screeningAuthorsValidator,
  publicationYear: v.optional(v.number()),
  doi: v.optional(v.string()),
  /** Where it was published, and how often it's cited: what a job's list shows beside a paper. */
  venue: v.optional(v.string()),
  citedByCount: v.optional(v.number()),
});

/**
 * The papers a job reads (#341), resolved on the server: a saved search by its ID in the
 * browser, a collection, every saved paper, or an earlier job's included papers.
 */
export const paperSetValidator = v.union(
  v.object({ kind: v.literal("search"), searchId: v.string() }),
  v.object({ kind: v.literal("collection"), collectionId: v.id("collections") }),
  v.object({ kind: v.literal("saved") }),
  v.object({ kind: v.literal("screening"), jobId: v.id("screeningJobs") }),
  // The person's own Zotero library, or one collection of it, or a group's of theirs: read through their connected account.
  v.object({ kind: v.literal("zotero"), collectionKey: v.optional(v.string()), groupId: v.optional(v.string()) }),
  // An Evidence Library's records as the person may read them there (plans/evidence-library-sources): its keys are kept when the job starts.
  v.object({ kind: v.literal("evidenceLibrary"), libraryId: v.id("evidenceLibraries"), source: librarySourceValidator }),
);

/** Where a job's included papers go: nowhere, a new collection by name, or one the person has. */
export const saveToValidator = v.union(
  v.object({ kind: v.literal("none") }),
  v.object({ kind: v.literal("new"), name: v.string() }),
  v.object({ kind: v.literal("collection"), collectionId: v.id("collections") }),
  // A collection in an Evidence Library the person owns or edits there, or a new one of theirs it makes once (by `requestId`).
  v.object({ kind: v.literal("libraryCollection"), libraryId: v.id("evidenceLibraries"), collection: v.string() }),
  v.object({ kind: v.literal("newLibraryCollection"), libraryId: v.id("evidenceLibraries"), name: v.string(), private: v.boolean(), requestId: v.string() }),
);

/** Whether a set's papers can leave it: a collection of the workspace's, or a reader's collection in a library (whose start checks the person edits it). */
export const prunable = (set: Infer<typeof paperSetValidator> | undefined) => set?.kind === "collection" || (set?.kind === "evidenceLibrary" && "readerCollection" in set.source && !("search" in set.source));

/** Where a job's included papers go in an Evidence Library: one of the person's collections there, by its ID and name. */
/** The papers shown under a source's range before it is read (./sampling.ts). */
export const SAMPLE_PAPERS = 3;
export const sampleValidator = capped(v.array(v.object({ title: v.string(), year: v.optional(v.number()) })), SAMPLE_PAPERS);

export const libraryDestinationValidator = v.object({ libraryId: v.id("evidenceLibraries"), collection: v.string(), name: v.string() });

/** How a paper went to a library collection: put in, or not, because the library holds no record of it. */
export const libraryWriteValidator = v.union(v.literal("added"), v.literal("missing"));
/** Why a job's writes to a library collection stopped: the person can no longer change it, it's gone, or the library didn't answer. */
export const libraryWriteProblemValidator = v.union(v.literal("role"), v.literal("notFound"), v.literal("unreadable"));

/**
 * Where a screened paper landed: included at the job's minimum score; unclear when its
 * unclear answers could still take it there; excluded; or failed, when the model couldn't read it.
 */
export const screeningOutcomeValidator = v.union(v.literal("included"), v.literal("unclear"), v.literal("excluded"), v.literal("failed"));

/** How each question's answers split across a job's papers, kept as papers settle. */
export const screeningTalliesValidator = capped(
  v.optional(v.array(v.object({ key: v.string(), yes: v.number(), no: v.number(), unclear: v.number() }))),
  MAX_QUESTIONS,
);

/** One paper of a job as its list shows it: the paper, its score, and its answer to each question now. */
export const screeningJobPaperValidator = v.object({
  ...sourceMetadataFields,
  /** The paper's key (lib/papers/paper-ref.ts), which the job's actions take, and what finds it elsewhere. */
  paper: v.string(),
  crossRefs: v.optional(crossRefsValidator),
  title: v.string(),
  abstract: v.optional(v.string()),
  authors: screeningAuthorsValidator,
  publicationYear: v.optional(v.number()),
  doi: v.optional(v.string()),
  venue: v.optional(v.string()),
  citedByCount: v.optional(v.number()),
  outcome: screeningOutcomeValidator,
  score: v.optional(v.number()),
  stars: v.optional(v.number()),
  /** By question key. `changed`: a person or the assistant set it; `confidence`: the model's in its own answer. */
  answers: capped(v.array(v.object({ key: v.string(), answer: v.union(v.boolean(), v.null()), changed: v.boolean(), confidence: v.optional(v.number()) })), MAX_QUESTIONS),
});

/**
 * Screening job lifecycle statuses.
 */
export const screeningJobStatusValidator = v.union(
  // A screening with reviewers that isn't started yet (./screenings.ts `sync`).
  v.literal("draft"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("failed"),
  v.literal("creditsExhausted")
);

/**
 * Individual screening result statuses.
 */
export const screeningResultStatusValidator = v.union(
  v.literal("processing"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("skipped")
);

/**
 * What a pass that starts papers needs to know and must not read itself (#796): each workspace's
 * limit comes from its account row, which its own charges rewrite several times a second, and a
 * pass that read it conflicted with them and ran again. The bookkeeping worker's query reads these
 * (it takes no read dependencies) and hands them to the pass (./slots.ts).
 */
export const startFactsValidator = v.object({
  limits: v.array(v.object({ workspaceId: v.id("workspaces"), limit: v.number() })),
  // Jobs with no spending limit among the papers a pass could start: the pass reads no row of theirs.
  uncapped: v.array(v.id("screeningJobs")),
});

// ── Screening with reviewers (plans/screening-reviewers) ─────────────────────────────────────────

/** A reviewer's answer to one criterion, and their vote on a paper. */
export const answerValidator = v.union(v.literal("yes"), v.literal("no"), v.literal("unclear"));
export const decisionValidator = v.union(v.literal("include"), v.literal("maybe"), v.literal("exclude"));
/** Where a paper stands: settled one way, split between its reviewers, or still short of votes. */
export const paperResultValidator = v.union(v.literal("include"), v.literal("maybe"), v.literal("exclude"), v.literal("conflict"), v.literal("waiting"));

/** Words an organiser marks on one criterion, and how long each is. */
export const MAX_TERMS = 20;
const TEXT = { name: 200, question: 2_000, criterion: 500, short: 40, note: 2_000, term: 80, voteNote: 2_000, message: 4_000 } as const;
export const SCREENING_TEXT = TEXT;

/** One criterion: the question, its short name, whether a paper must meet it, guidance, marked words, and what each answer is worth. */
export const criterionValidator = v.object({
  key: v.string(),
  text: v.string(),
  short: v.string(),
  must: v.boolean(),
  note: v.optional(v.string()),
  terms: capped(v.array(v.string()), MAX_TERMS),
  addedAt: v.number(),
  points: v.object({ yes: v.number(), no: v.number(), unclear: v.number() }),
});
export const criteriaValidator = capped(v.array(criterionValidator), MAX_QUESTIONS);

/** How papers are shared out and settled (lib/screening/rules.ts). */
export const ruleValidator = v.object({
  each: v.union(v.number(), v.literal("all")),
  settle: v.union(v.literal("all"), v.literal("most"), v.literal("one")),
  resolver: v.id("users"),
  blind: v.union(v.literal("after"), v.literal("always")),
});

export const everyValidator = v.union(v.literal("day"), v.literal("week"), v.literal("month"));

/** A vote's answers, a model's confidence in each, and the sentence of the abstract it relied on for each, counted from 0. */
export const voteAnswersValidator = capped(v.record(v.string(), answerValidator), MAX_QUESTIONS);
export const votePassagesValidator = capped(v.record(v.string(), v.number()), MAX_QUESTIONS);

/** A reviewer's place on a paper (lib/screening/rules.ts `Ballot`). */
export const voteStatusValidator = v.union(v.literal("waiting"), v.literal("cast"), v.literal("failed"), v.literal("closed"), v.literal("discarded"));

/**
 * Where a source's papers come from: one of the sets a job reads (`paperSetValidator`), a file of references or a
 * table kept in storage, PDFs kept in storage, or a pasted list of DOIs kept there too.
 */
export const sourceSetValidator = v.union(
  v.object({ kind: v.literal("search"), searchId: v.string() }),
  v.object({ kind: v.literal("collection"), collectionId: v.id("collections") }),
  v.object({ kind: v.literal("saved") }),
  v.object({ kind: v.literal("screening"), jobId: v.id("screeningJobs") }),
  v.object({ kind: v.literal("evidenceLibrary"), libraryId: v.id("evidenceLibraries"), source: librarySourceValidator }),
  // `deep`: with the collections under the one it names.
  v.object({ kind: v.literal("zotero"), collectionKey: v.optional(v.string()), groupId: v.optional(v.string()), deep: v.optional(v.boolean()) }),
  // `columns`: which of a table's columns is the title, the abstract and so on, where its headings didn't say.
  v.object({ kind: v.literal("upload"), file: v.id("_storage"), columns: capped(v.optional(v.record(v.string(), v.string())), 20) }),
  // `batch`: the PDFs of one drop in the form, each a row of `screeningFiles` (./files.ts).
  v.object({ kind: v.literal("pdf"), batch: v.string() }),
  v.object({ kind: v.literal("dois"), file: v.id("_storage") }),
);

/** One page of a person's Zotero groups, as Zotero pages them (../zotero/libraryValidators.ts `ZOTERO_LIST_PAGE`), with where the next page starts. */
const ZOTERO_LISTED = 100;
export const zoteroGroupsValidator = v.object({ page: capped(v.array(v.object({ id: v.string(), name: v.string(), papers: v.number() })), ZOTERO_LISTED), next: v.optional(v.number()) });
/** A pasted list of DOIs, kept as a file a screening can read, and how many it holds (./held.ts `keepDois`). */
export const doisKeptValidator = v.object({ file: v.id("_storage"), dois: v.number() });
/** The most DOIs one pasted list holds. */
export const DOIS_MAX = 5_000;

/** What a file a person is about to add holds (./held.ts `look`). */
export const fileLookValidator = v.object({
  records: v.number(),
  table: v.optional(v.object({ heads: capped(v.array(v.string()), 200), picked: capped(v.record(v.string(), v.string()), 20), ask: v.boolean() })),
});

/** Why something a source held isn't screened. */
/** `twice`: the source holds the paper as another of its own records, and that one is screened. */
export const leftOutWhyValidator = v.union(v.literal("abstract"), v.literal("title"), v.literal("doi"), v.literal("record"), v.literal("broken"), v.literal("twice"));

/** Where a PDF handed to a screening stands: still to be read, read, or a file that doesn't open. */
export const pdfStateValidator = v.union(v.literal("waiting"), v.literal("read"), v.literal("broken"));
/** What the first reading of a PDF found (./heldPdfs.ts `look`): its pages, and the title, authors, year and DOI it prints. `known`: the index holds the paper its DOI names, under the title it prints. `bare`: that paper has no abstract there, so it is read as the file. */
export const pdfReadValidator = v.object({
  state: v.union(v.literal("read"), v.literal("broken")),
  pages: v.optional(v.number()),
  title: v.optional(v.string()),
  authors: screeningAuthorsValidator,
  year: v.optional(v.number()),
  doi: v.optional(v.string()),
  known: v.optional(v.boolean()),
  bare: v.optional(v.boolean()),
});
/** PDFs one call adds to a drop, and the rows of a drop a page of its list shows. */
export const PDFS_A_CALL = 50;
/** How a drop of PDFs stands, for the form: how many it holds, how many are still to be read, how many are papers the index holds, how many are screened as the file they are, and how many don't open. */
export const pdfDropValidator = v.object({ total: v.number(), waiting: v.number(), known: v.number(), file: v.number(), broken: v.number() });

/** What a reviewer's votes come to, kept by the bookkeeping worker alone. */
/** What a reviewer's votes come to. `missed`: the papers the screening included that they voted to exclude. */
export const reviewerCountsValidator = v.object({ cast: v.number(), include: v.number(), maybe: v.number(), exclude: v.number(), failed: v.number(), closed: v.number(), spent: v.number(), missed: v.optional(v.number()) });

// ── What the pages read (./view.ts, ./paperViews.ts) ─────────────────────────────────────────────
// Each list here is one its writes keep within a cap: a screening's reviewers and sources, and a paper's votes.

/** The most reviewers a screening has, people who left it included, and the most sources it has ever had. */
export const MAX_REVIEWERS = 200;
export const MAX_SOURCE_ROWS = 100;

export const starsValidator = capped(v.optional(v.array(v.number())), MAX_STARS);
export const voteConfidencesValidator = capped(v.optional(v.record(v.string(), v.number())), MAX_QUESTIONS);
export const optionalPassagesValidator = capped(v.optional(v.record(v.string(), v.number())), MAX_QUESTIONS);

/** A model on a screening. `files`: it takes a PDF as a file, so a paper that is only its PDF is given to it. */
const modelViewValidator = v.object({ _id: v.id("models"), modelId: v.string(), name: v.string(), inputPricePerMillion: v.number(), outputPricePerMillion: v.number(), longPrompt: v.optional(longPromptValidator), contextLength: v.optional(v.number()), effort: v.optional(effortValidator), available: v.boolean(), files: v.boolean() });

/**
 * A reviewer as every page shows them. `id` is what a vote, a rule or a link names them by: a person's account, and
 * a model's own row. `row` is their row, which changes to them take.
 */
export const reviewerViewValidator = v.object({
  // Their papers settled without their vote.
  closed: v.number(),
  row: v.id("screeningReviewers"),
  id: v.string(),
  kind: v.union(v.literal("person"), v.literal("model")),
  name: v.string(),
  imageUrl: v.optional(v.string()),
  model: v.optional(modelViewValidator),
  // From outside the screening's workspace: they vote as a guest of it.
  guest: v.optional(v.literal(true)),
  addedAt: v.number(),
  left: v.optional(v.number()),
  discarded: v.optional(v.number()),
  reminded: v.optional(v.number()),
  // Papers given to them, the ones they voted on by how, the ones a model couldn't read, the ones that still wait for them, and what a model has cost.
  dealt: v.number(),
  cast: v.number(),
  include: v.number(),
  maybe: v.number(),
  exclude: v.number(),
  failed: v.number(),
  waiting: v.number(),
  spent: v.number(),
  // The papers the screening included that they voted to exclude.
  missed: v.number(),
  // How they voted is kept from whoever looks, who still has papers of this screening to vote on: only how far they are is said.
  kept: v.optional(v.literal(true)),
});
export const reviewerViewsValidator = capped(v.array(reviewerViewValidator), MAX_REVIEWERS);

/** Screenings in the person's other workspaces that one page points at. */
export const ELSEWHERE_MAX = 20;
/** A screening that waits for the person in a workspace other than the one they are in: its name, where it is, the organization whose address opens it (none where it opens in their own workspace), and what waits. */
export const elsewhereValidator = capped(v.array(v.object({ id: v.id("screeningJobs"), name: v.string(), in: v.string(), slug: v.optional(v.string()), forYou: v.number(), conflicts: v.number(), asked: v.number() })), ELSEWHERE_MAX);

/** What tells a source from another of the same name, as the list it was picked from said it: a few short facts. */
export const SOURCE_FACTS = 6;
export const sourceFactsValidator = capped(v.optional(v.array(v.string())), SOURCE_FACTS);

export const sourceViewValidator = v.object({
  id: v.id("screeningSources"),
  set: sourceSetValidator,
  name: v.string(),
  detail: v.optional(v.string()),
  facts: sourceFactsValidator,
  first: v.optional(v.number()),
  last: v.optional(v.number()),
  addedAt: v.number(),
  removedAt: v.optional(v.number()),
  state: v.union(v.literal("waiting"), v.literal("reading"), v.literal("done"), v.literal("failed")),
  failure: v.optional(v.string()),
  // What it holds, how many of its papers were read, and of those the ones taken, merged with another source's and left out.
  total: v.optional(v.number()),
  read: v.number(),
  taken: v.number(),
  duplicates: v.number(),
  left: v.number(),
  // Of the ones left out, how many for having no abstract.
  bare: v.number(),
  // Of the ones taken, how many are screened as their own PDF, and the pages those have.
  filed: v.number(),
  filePages: v.number(),
  // Those pages by the length of the paper they are in (lib/pricing/estimate.ts `Pdfs`).
  fileSpread: capped(v.optional(v.record(v.string(), v.object({ papers: v.number(), pages: v.number() }))), PDF_BANDS),
  // Its reading stopped at the most papers the workspace's plan gives one screening.
  capped: v.optional(v.literal(true)),
  checkedAt: v.optional(v.number()),
});
export const sourceViewsValidator = capped(v.array(sourceViewValidator), MAX_SOURCE_ROWS);
/** The papers a later check added, by the source that brought them. */
export const checkSourcesValidator = capped(v.optional(v.array(v.object({ id: v.id("screeningSources"), added: v.number() }))), MAX_SOURCE_ROWS);

/** A vote as a page shows it. */
export const voteViewValidator = v.object({
  decision: decisionValidator,
  answers: voteAnswersValidator,
  reason: v.optional(v.string()),
  note: v.optional(v.string()),
  at: v.number(),
  flagged: v.optional(v.boolean()),
  confidences: voteConfidencesValidator,
  passages: optionalPassagesValidator,
});
/** One reviewer's place on a paper: their vote where the person looking may see it, that a model couldn't read the paper, that they voted and how is kept from the person (`hidden`), or only that they are on it. */
const castViewValidator = v.object({ reviewer: v.string(), vote: v.optional(voteViewValidator), failed: v.optional(v.boolean()), hidden: v.optional(v.boolean()) });

/** A paper with the votes the person looking may see (./paperViews.ts `shown`). */
export const paperViewValidator = v.object({
  id: v.id("screeningResults"),
  key: v.string(),
  title: v.string(),
  authors: screeningAuthorsValidator,
  year: v.optional(v.number()),
  venue: v.optional(v.string()),
  cited: v.optional(v.number()),
  doi: v.optional(v.string()),
  abstract: v.string(),
  // It has no abstract and is screened as its own PDF, of this many pages (./paperViews.ts `pdf` gives the file).
  pdf: v.optional(v.object({ pages: v.optional(v.number()) })),
  source: v.optional(v.id("screeningSources")),
  batch: v.optional(v.id("screeningChecks")),
  // When a later check brought it, for a paper that wasn't there from the start.
  addedAt: v.optional(v.number()),
  place: v.number(),
  result: paperResultValidator,
  reason: v.optional(v.string()),
  points: v.optional(v.number()),
  stars: v.optional(v.number()),
  // A person settled it, whatever its votes say.
  resolved: v.optional(v.object({ by: v.id("users"), note: v.optional(v.string()), reason: v.optional(v.string()), at: v.number() })),
  // Whether the person looking sees the other votes on it, and what was written about it.
  sees: v.boolean(),
  cast: capped(v.array(castViewValidator), MAX_REVIEWERS),
  // Whether the paper is theirs to vote on.
  mine: v.boolean(),
  messages: v.number(),
  // A reviewer's question on it waits for the person looking.
  asked: v.optional(v.boolean()),
});

/** Pairs of reviewers whose agreement one read holds. */
export const PAIRS_MAX = 400;
/** The figures a screening's overview and its files are drawn from (./view.ts `figures`). */
export const figuresValidator = v.object({
  // Its excluded papers by the reason, and its included ones by the source that brought each.
  reasons: capped(v.record(v.string(), v.number()), MAX_QUESTIONS + 2),
  included: capped(v.record(v.string(), v.number()), MAX_SOURCE_ROWS),
  // Each pair of reviewers' votes on the papers both voted on: include, maybe and exclude by the same three, row by row.
  pairs: capped(v.array(v.object({ a: v.string(), b: v.string(), matrix: capped(v.array(v.number()), 9) })), PAIRS_MAX),
  // The votes each person cast since the time asked for.
  recent: capped(v.record(v.string(), v.number()), MAX_REVIEWERS),
  startedWith: v.number(),
  // Its checks for new papers after the start: how many, when the last one was, and what they found and added.
  checks: v.object({ later: v.number(), lastAt: v.optional(v.number()), found: v.number(), added: v.number() }),
  // How many times its settings were changed.
  changes: v.number(),
});

/** The papers one move of a change's preview names, and the moves there can be: from each of five results to the four others. */
export const PREVIEW_PAPERS = 40;
const RESULT_MOVES = 20;
const previewMoveValidator = v.object({
  from: paperResultValidator,
  to: paperResultValidator,
  count: v.number(),
  // The first of them, and how many the person asking can't be shown: votes on them are hidden from them.
  papers: capped(v.array(v.object({ id: v.id("screeningResults"), title: v.string(), year: v.optional(v.number()) })), PREVIEW_PAPERS),
  hidden: v.number(),
});
/** What a change to a running screening would do, as ./effects.ts counts it. Reviewers are named by their row, or by what names them before they have one: a person's account, a model's slug and effort. */
export const previewValidator = v.object({
  // Its papers once the change is made, and how many of them the change opens again.
  total: v.number(),
  reopened: v.number(),
  // Each reviewer the change puts on it: the papers a model reads, the open papers a person gets.
  joining: capped(v.record(v.string(), v.object({ reads: v.optional(v.number()), dealt: v.optional(v.number()) })), MAX_REVIEWERS),
  // Each reviewer it takes off: their votes, the papers of theirs that go to someone else (voted on or not, and to whom), and the ones nobody takes that settle or go on waiting.
  leaving: capped(v.record(v.string(), v.object({ cast: v.number(), unvoted: v.number(), voted: v.number(), to: capped(v.array(v.string()), MAX_REVIEWERS), settled: v.number(), waiting: v.number() })), MAX_REVIEWERS),
  // Open papers whose number of places changes.
  eachChanged: v.number(),
  // Each model that stays: the papers it has still to read once the change is made, and the ones the change has it read at once.
  models: capped(v.record(v.string(), v.object({ ahead: v.number(), atOnce: v.number() })), MAX_REVIEWERS),
  // Papers that leave with a source taken out, and the ones it has included. What a source being added brings is known once it is read.
  removed: v.number(),
  included: v.number(),
  moves: capped(v.array(previewMoveValidator), RESULT_MOVES),
  // Settled papers that would move if they were checked again.
  again: v.number(),
  // The fewest and the most papers a person would have.
  loads: v.optional(v.object({ least: v.number(), most: v.number() })),
});
