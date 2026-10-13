import { v, type Infer } from "convex/values";
import { paperIdentityFields } from "../lib/paperRef";
import { capped, MAX_AUTHORS, MAX_RATERS_KEPT } from "../lib/listCaps";

export const librarySortValidator = v.union(
  v.literal("savedAt"),
  v.literal("rating"),
  v.literal("publicationYear"),
  v.literal("citedByCount"),
  v.literal("title"),
);
export const librarySortOrderValidator = v.union(v.literal("asc"), v.literal("desc"));

export const libraryFilterFields = {
  minRating: v.optional(v.number()),
  maxRating: v.optional(v.number()),
  savedAfter: v.optional(v.number()),
  savedBefore: v.optional(v.number()),
  yearFrom: v.optional(v.number()),
  yearTo: v.optional(v.number()),
  // Read from the page's address, so it can be anything: one that is no collection's ID reads as a collection that is gone (#826).
  collectionId: v.optional(v.string()),
};

/** A view of the library: its sort, its filters, and an optional text search. */
export const libraryViewValidator = v.object({
  sortBy: librarySortValidator,
  sortOrder: librarySortOrderValidator,
  ...libraryFilterFields,
  searchText: v.optional(v.string()),
});
export type LibraryView = Infer<typeof libraryViewValidator>;

/** Papers of the library the assistant reads at once (./queries.ts). */
export const PAPERS_PAGE = 20;
/** A page of the library as the assistant reads it: each paper in short, with how many match. */
export const libraryPapersValidator = v.object({
  /** How many papers the view has, when that's kept as a count: the whole library, or one collection. A narrowed view is counted by library/queries:countPapers. */
  total: v.optional(v.number()),
  papers: capped(
    v.array(
      v.object({
        /** The person's own saved copy. Left out for a paper of a collection shared with them from another workspace that they haven't saved themselves. */
        libraryItemId: v.optional(v.id("libraryItems")),
        id: v.string(),
        title: v.string(),
        authors: v.optional(v.string()),
        year: v.optional(v.number()),
        journal: v.optional(v.string()),
        rating: v.optional(v.number()),
        inCollection: v.boolean(),
        savedOn: v.string(),
        /** OpenAlex knows of an open-access PDF of it, which research/papers:readPdf reads. */
        pdf: v.optional(v.literal(true)),
      }),
    ),
    PAPERS_PAGE,
  ),
  /** Given as `cursor`, reads the page after this one. Left out on the last. */
  next: v.optional(v.string()),
});

/** What the library keeps of a saved paper. */
export const libraryItemFields = {
    workspaceId: v.id("workspaces"),
    createdBy: v.id("users"),
    // The paper by its source (plans/evidence-library-sources).
    ...paperIdentityFields,
    rating: v.optional(v.number()), // 0-5; unset when the paper was saved without rating it
    // In an organization's library `rating` is its members' average of their own ratings (#801): how many of them gave one,
    // and the first of them with what each gave, kept in step with it (convex/ratings.ts). Unset in a person's own workspace.
    ratingCount: v.optional(v.number()),
    ratedBy: capped(v.optional(v.array(v.object({ id: v.id("ratings"), userId: v.id("users"), rating: v.number() }))), MAX_RATERS_KEPT),
    title: v.string(),
    authors: capped(v.optional(v.array(v.string())), MAX_AUTHORS),
    authorsUnparsed: v.optional(v.string()),
    metadataVersion: v.optional(v.literal(2)),
    metadataRecoveredAt: v.optional(v.number()),
    doi: v.optional(v.string()),
    abstract: v.optional(v.string()),
    publicationYear: v.optional(v.number()),
    journal: v.optional(v.string()), // primary_location.source.display_name
    citedByCount: v.optional(v.number()),
    workType: v.optional(v.string()), // OpenAlex `type` — "article" | "review" | "book-chapter" | ...
    isOpenAccess: v.optional(v.boolean()),
    oaStatus: v.optional(v.string()), // "gold" | "green" | "bronze" | "hybrid" | "closed"
    oaUrl: v.optional(v.string()),
    pdfUrl: v.optional(v.string()),
    paperData: v.optional(v.string()), // Full PaperResult JSON for rich card rendering
    searchableText: v.string(), // title + abstract + authors (for Phase 23 search index)
    savedAt: v.number(),
    updatedAt: v.number(),
};

const { workspaceId: _workspace, ...removedItemFields } = libraryItemFields;
/** A removed paper as it was, apart from which workspace's it was: the removal keeps that. */
export const removedItemValidator = v.object(removedItemFields);
