import { v, type Infer } from "convex/values";

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
