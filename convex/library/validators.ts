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

export const libraryExportFormatValidator = v.union(v.literal("csv"), v.literal("json"));
