import { v, type Infer } from "convex/values";
import { MAX_ISSUE_KINDS, MAX_LIBRARY_SOURCES, capped } from "../lib/listCaps";

/**
 * A library's source status as its runtime reports it: version 1 of the
 * contract in new-el's `src/lib/source-ingestion/source-status.ts`.
 */
const failureCodeValidator = v.union(
  v.literal("access_denied"),
  v.literal("owner_left"),
  v.literal("not_found"),
  v.literal("missing_key"),
  v.literal("invalid_query"),
  v.literal("too_large"),
  v.literal("rate_limited"),
  v.literal("unavailable"),
  v.literal("interrupted"),
  v.literal("internal"),
);

const base = {
  key: v.string(),
  provider: v.union(
    v.literal("zotero"),
    v.literal("mendeley"),
    v.literal("openalex"),
    v.literal("openscholar"),
    v.literal("dspace"),
    v.literal("eprints"),
  ),
  /** Null while the source imports, when the runtime does not count it. */
  searchable: v.union(v.number(), v.null()),
  searchFailed: v.number(),
  changed: v.union(v.number(), v.null()),
  lastSuccessAt: v.union(v.string(), v.null()),
  issues: capped(v.record(v.string(), v.number()), MAX_ISSUE_KINDS),
  /**
   * PDFs added to the records and those that could not be downloaded. Null
   * for a source without PDFs, and missing from runtimes older than the PDF
   * step. While PDFs are added, the counts of that run.
   */
  pdfs: v.optional(v.union(v.object({ added: v.number(), missed: v.number() }), v.null())),
  /**
   * What the source's screening found: its records by grade against its subject, how many are not graded against
   * the current subject, and progress while the owner's request to grade them runs. Null for a source that does not
   * screen, and missing from runtimes older than screening. Newer runtimes add the subject they screen against, how
   * many records the source holds, a recently graded record's title for each grade, and, while records wait to be
   * read, the latest one and how many are left.
   */
  screening: v.optional(v.union(v.object({
    grades: v.object({ about: v.number(), touches: v.number(), passing: v.number(), notAbout: v.number() }),
    ungraded: v.number(),
    grading: v.union(v.object({ done: v.number(), of: v.number() }), v.null()),
    subject: v.optional(v.string()),
    /** Every record the source holds, graded or not. */
    records: v.optional(v.number()),
    examples: v.optional(v.object({
      about: v.union(v.string(), v.null()),
      touches: v.union(v.string(), v.null()),
      passing: v.union(v.string(), v.null()),
      notAbout: v.union(v.string(), v.null()),
    })),
    reading: v.optional(v.union(v.object({ title: v.string(), left: v.number() }), v.null())),
  }), v.null())),
};

export const sourceStatusValidator = v.union(
  v.object({
    ...base,
    state: v.literal("running"),
    /** Records are imported and made searchable, then PDFs are added. */
    phase: v.union(v.literal("import"), v.literal("search"), v.literal("pdfs")),
    done: v.number(),
    total: v.union(v.number(), v.null()),
    startedAt: v.string(),
    minutesLeft: v.union(v.number(), v.null()),
  }),
  v.object({
    ...base,
    state: v.literal("failed"),
    failure: v.object({ code: failureCodeValidator, details: v.string(), at: v.string() }),
    /** Set when the run stopped while adding PDFs: the records are all in. */
    failedIn: v.optional(v.literal("pdfs")),
  }),
  v.object({ ...base, state: v.literal("succeeded") }),
  v.object({ ...base, state: v.literal("idle") }),
);

export type SourceStatus = Infer<typeof sourceStatusValidator>;

export const sourceStatusSnapshotValidator = v.object({
  version: v.literal(1),
  libraryId: v.string(),
  observedAt: v.string(),
  sources: capped(v.array(sourceStatusValidator), MAX_LIBRARY_SOURCES),
  /** The community's public records, each counted once however many of its sources hold it. Runtimes older than it leave it out. */
  records: v.optional(v.number()),
});

export const evidenceLibrarySourceStatusFields = {
  libraryId: v.id("evidenceLibraries"),
  observedAt: v.number(),
  sources: capped(v.array(sourceStatusValidator), MAX_LIBRARY_SOURCES),
  /** The community's public records, each counted once however many of its sources hold it. Runtimes older than it leave it out. */
  records: v.optional(v.number()),
};

/** The runtime's latest report on a library's sources, or null before its first. */
export const sourceStatusReadValidator = v.union(v.null(), v.object({ observedAt: v.number(), sources: evidenceLibrarySourceStatusFields.sources }));

/** An owner's request to grade a screening source, waiting for the library to report its subject (./screeningRequests.ts). */
export const screeningRequestFields = {
  libraryId: v.id("evidenceLibraries"),
  sourceKey: v.string(),
  /** The subject the owner asked to grade against. */
  subject: v.string(),
  requestedBy: v.id("users"),
  requestedAt: v.number(),
  /** Set while it is on its way to the library, so a report arriving meanwhile doesn't send it twice. */
  sendingAt: v.optional(v.number()),
  /** When the library took it; it stays until the library's report shows the grading, so the page never loses sight of it. */
  sentAt: v.optional(v.number()),
  /** Why the library refused it, shown on the source until the owner asks again. */
  error: v.optional(v.string()),
};
