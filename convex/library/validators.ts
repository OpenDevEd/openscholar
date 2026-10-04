import { v, type Infer } from "convex/values";
import { capped } from "../lib/listCaps";

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
  collectionId: v.optional(v.id("collections")),
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
  /** How many papers match, and whether the count stopped short of them all. */
  total: v.number(),
  totalIsAtLeast: v.optional(v.literal(true)),
  papers: capped(
    v.array(
      v.object({
        libraryItemId: v.id("libraryItems"),
        id: v.string(),
        title: v.string(),
        authors: v.optional(v.string()),
        year: v.optional(v.number()),
        journal: v.optional(v.string()),
        rating: v.optional(v.number()),
        savedOn: v.string(),
      }),
    ),
    PAPERS_PAGE,
  ),
  /** Given as `cursor`, reads the page after this one. Left out on the last. */
  next: v.optional(v.string()),
});

/** What the library keeps of a saved paper. */
export const libraryItemFields = {
    userId: v.id("users"),
    openalexId: v.string(), // e.g. "https://openalex.org/W1234567890"
    rating: v.optional(v.number()), // 0-5; unset when the paper was saved without rating it
    title: v.string(),
    authors: v.optional(v.string()), // Flattened: "John Doe, Jane Smith"
    doi: v.optional(v.string()),
    abstract: v.optional(v.string()),
    publicationYear: v.optional(v.number()),
    journal: v.optional(v.string()), // primary_location.source.display_name
    citedByCount: v.optional(v.number()),
    workType: v.optional(v.string()), // OpenAlex `type` — "article" | "review" | "book-chapter" | ...
    isOpenAccess: v.optional(v.boolean()),
    oaStatus: v.optional(v.string()), // "gold" | "green" | "bronze" | "hybrid" | "closed"
    paperData: v.optional(v.string()), // Full PaperResult JSON for rich card rendering
    searchableText: v.string(), // title + abstract + authors (for Phase 23 search index)
    savedAt: v.number(),
    updatedAt: v.number(),
};

const { userId: _owner, ...removedItemFields } = libraryItemFields;
/** A removed paper as it was, apart from whose it was. */
export const removedItemValidator = v.object(removedItemFields);
