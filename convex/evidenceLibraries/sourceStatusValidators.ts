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
});

export const evidenceLibrarySourceStatusFields = {
  libraryId: v.id("evidenceLibraries"),
  observedAt: v.number(),
  sources: capped(v.array(sourceStatusValidator), MAX_LIBRARY_SOURCES),
};

