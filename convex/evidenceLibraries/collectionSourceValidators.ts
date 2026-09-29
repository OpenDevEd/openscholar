import { v } from "convex/values";

// One OpenScholar collection a library follows, and who connected it. Only
// the collection's owner can connect it, and the library keeps reading it
// only while that person stays in the library's organization.
export const evidenceLibraryCollectionSourceFields = {
  libraryId: v.id("evidenceLibraries"),
  collectionId: v.id("collections"),
  connectedByClerkUserId: v.string(),
  connectedAt: v.number(),
};
