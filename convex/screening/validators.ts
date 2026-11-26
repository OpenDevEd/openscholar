import { v, type Infer } from "convex/values";
import { MAX_AUTHORS, MAX_QUESTIONS, MAX_STARS, capped } from "../lib/listCaps";
import { answerSourceValidator } from "../../lib/research/records";
import { sourceMetadataFields } from "../lib/paperMetadata";
import { crossRefsValidator } from "../lib/paperRef";
import { librarySourceValidator } from "../evidenceLibraries/validators";

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
  v.object({ kind: v.literal("upload"), file: v.id("_storage"), columns: v.optional(v.record(v.string(), v.string())) }),
  v.object({ kind: v.literal("pdf"), files: capped(v.array(v.object({ file: v.id("_storage"), name: v.string() })), 200) }),
  v.object({ kind: v.literal("dois"), file: v.id("_storage") }),
);

/** Why something a source held isn't screened. */
export const leftOutWhyValidator = v.union(v.literal("abstract"), v.literal("title"), v.literal("doi"), v.literal("record"), v.literal("scan"), v.literal("broken"), v.literal("wrong"));

/** What a reviewer's votes come to, kept by the bookkeeping worker alone. */
export const reviewerCountsValidator = v.object({ cast: v.number(), include: v.number(), maybe: v.number(), exclude: v.number(), failed: v.number(), closed: v.number(), spent: v.number() });
