import { v, type Infer } from "convex/values";

/**
 * A library's source status as its runtime reports it: version 1 of the
 * contract in new-el's `src/lib/source-ingestion/source-status.ts`.
 */
const failureCodeValidator = v.union(
  v.literal("access_denied"),
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
    v.literal("dspace"),
    v.literal("eprints"),
  ),
  searchable: v.number(),
  searchFailed: v.number(),
  changed: v.union(v.number(), v.null()),
  lastSuccessAt: v.union(v.string(), v.null()),
  issues: v.record(v.string(), v.number()),
};

export const sourceStatusValidator = v.union(
  v.object({
    ...base,
    state: v.literal("running"),
    phase: v.union(v.literal("import"), v.literal("search")),
    done: v.number(),
    total: v.union(v.number(), v.null()),
    startedAt: v.string(),
    minutesLeft: v.union(v.number(), v.null()),
  }),
  v.object({
    ...base,
    state: v.literal("failed"),
    failure: v.object({ code: failureCodeValidator, details: v.string(), at: v.string() }),
  }),
  v.object({ ...base, state: v.literal("succeeded") }),
  v.object({ ...base, state: v.literal("idle") }),
);

export type SourceStatus = Infer<typeof sourceStatusValidator>;

export const sourceStatusSnapshotValidator = v.object({
  version: v.literal(1),
  libraryId: v.string(),
  observedAt: v.string(),
  sources: v.array(sourceStatusValidator),
});

export const evidenceLibrarySourceStatusFields = {
  libraryId: v.id("evidenceLibraries"),
  observedAt: v.number(),
  sources: v.array(sourceStatusValidator),
};

