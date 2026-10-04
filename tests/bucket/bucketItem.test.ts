import { describe, expect, test } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import {
  fromSearchHistoryEntry,
  fromLibraryItem,
  fromCollectionItem,
  fromZoteroItem,
  fromUpload,
  fromSavedSearchQuery,
  zoteroBucketKeyFor,
} from "@/lib/bucket/bucketItem";

function libraryDoc(overrides: {
  _id?: Id<"libraryItems">;
  openalexId?: string;
  title?: string;
  authors?: string | string[];
  doi?: string;
  publicationYear?: number;
  abstract?: string;
  journal?: string;
  citedByCount?: number;
  workType?: string;
} = {}) {
  return {
    _id: (overrides._id ?? "lib_1") as Id<"libraryItems">,
    _creationTime: 0,
    userId: "user_1" as Id<"users">,
    openalexId: overrides.openalexId ?? "https://openalex.org/W999",
    rating: 0,
    title: overrides.title ?? "A Library Item",
    authors: overrides.authors,
    doi: overrides.doi,
    abstract: overrides.abstract,
    publicationYear: overrides.publicationYear,
    journal: overrides.journal,
    citedByCount: overrides.citedByCount,
    workType: overrides.workType,
    searchableText: "",
    savedAt: 0,
    updatedAt: 0,
  };
}

describe("lib/bucket/bucketItem normalizers", () => {
  test("fromSearchHistoryEntry keys on openalexId with source=history", () => {
    const item = fromSearchHistoryEntry(
      {
        openalexId: "https://openalex.org/W1",
        title: "Paper One",
        authors: ["Alice", "Bob"],
        year: 2021,
      },
      "history_abc",
    );
    expect(item.source).toBe("history");
    expect(item.bucketKey).toBe("openalex:W1");
    expect(item.sourceRefId).toBe("history_abc");
    expect(item.title).toBe("Paper One");
    expect(item.authors).toEqual(["Alice", "Bob"]);
    expect(item.year).toBe(2021);
    expect(item.status).toBe("ready");
  });

  test("fromLibraryItem keys on openalexId and keeps author boundaries, source=library", () => {
    const item = fromLibraryItem(
      libraryDoc({
        openalexId: "https://openalex.org/W5",
        authors: ["Smith, Jr., John", "Bob Jones"],
        doi: "10.1/lib",
        title: "Lib Paper",
        publicationYear: 2020,
      }),
    );
    expect(item.source).toBe("library");
    expect(item.bucketKey).toBe("openalex:W5");
    expect(item.authors).toEqual(["Smith, Jr., John", "Bob Jones"]);
    expect(item.sourceRefId).toBe("lib_1");
    expect(item.title).toBe("Lib Paper");
    expect(item.year).toBe(2020);
    expect(item.status).toBe("ready");
  });

  test("fromLibraryItem handles empty authors", () => {
    const item = fromLibraryItem(libraryDoc({ authors: undefined }));
    expect(item.authors).toEqual([]);
  });

  test("fromLibraryItem forwards citedByCount, journal-as-venueName, and workType to the bucket item", () => {
    const item = fromLibraryItem(
      libraryDoc({
        citedByCount: 88,
        journal: "Cell",
        workType: "review",
      }),
    );
    expect(item.citedByCount).toBe(88);
    expect(item.venueName).toBe("Cell");
    expect(item.workType).toBe("review");
  });

  test("fromCollectionItem matches library shape plus collection source + meta", () => {
    const libDoc = libraryDoc({ openalexId: "W9", title: "Col Paper" });
    const collectionId = "col_42" as Id<"collections">;
    const item = fromCollectionItem(libDoc, collectionId);
    expect(item.source).toBe("collection");
    expect(item.bucketKey).toBe("openalex:W9");
    expect(item.sourceMeta).toEqual({ collectionId });
  });

  test("fromZoteroItem keys on DOI when present, source=zotero with meta", () => {
    const item = fromZoteroItem(
      {
        itemKey: "ZOT1",
        title: "Z Paper",
        authors: ["A", "B"],
        doi: "10.1/zot",
        year: 2023,
      },
      { libraryType: "group", groupId: "g1", collectionKey: "c1" },
    );
    expect(item.source).toBe("zotero");
    expect(item.bucketKey).toBe("doi:10.1/zot");
    expect(item.sourceRefId).toBe("ZOT1");
    expect(item.sourceMeta).toEqual({
      libraryType: "group",
      groupId: "g1",
      collectionKey: "c1",
    });
  });

  test("fromZoteroItem threads venueName and workType onto the bucket item for the chat prompt", () => {
    const item = fromZoteroItem(
      {
        itemKey: "ZOT3",
        title: "Z Paper",
        authors: ["A"],
        doi: "10.1/zot",
        year: 2023,
        venueName: "Journal of Examples",
        workType: "journalArticle",
      },
      { libraryType: "user" },
    );
    expect(item.venueName).toBe("Journal of Examples");
    expect(item.workType).toBe("journalArticle");
  });

  test("fromZoteroItem leaves venueName/workType undefined when input omits them", () => {
    const item = fromZoteroItem(
      { itemKey: "ZOT4", title: "Bare", authors: [], year: 2024 },
      { libraryType: "user" },
    );
    expect(item.venueName).toBeUndefined();
    expect(item.workType).toBeUndefined();
  });

  test("fromZoteroItem falls back to title+year key when no DOI", () => {
    const item = fromZoteroItem(
      { itemKey: "ZOT2", title: "Untitled", authors: [], year: 2024 },
      { libraryType: "user" },
    );
    expect(item.bucketKey).toBe("title:untitled#2024");
  });

  test("fromUpload uses DOI key when supplied, status stays uploading", () => {
    const item = fromUpload({
      uploadId: "up_1",
      title: "Upload Paper",
      doi: "10.1/up",
    });
    expect(item.source).toBe("upload");
    expect(item.bucketKey).toBe("doi:10.1/up");
    expect(item.status).toBe("uploading");
    expect(item.sourceRefId).toBe("up_1");
  });

  test("fromUpload uses a stable upload:<id> key when no DOI", () => {
    const item = fromUpload({
      uploadId: "up_2",
      title: "Some PDF",
    });
    expect(item.bucketKey).toBe("upload:up_2");
    expect(item.source).toBe("upload");
  });

  test("fromUpload transitions to ready when storageId provided", () => {
    const storageId = "kg2_abc" as unknown as Id<"_storage">;
    const item = fromUpload({
      uploadId: "up_3",
      title: "Done PDF",
      storageId,
      status: "ready",
    });
    expect(item.status).toBe("ready");
    expect(item.storageId).toBe(storageId);
  });

  test("zoteroBucketKeyFor returns the same key as fromZoteroItem(...).bucketKey", () => {
    const input = { title: "Z Paper", authors: [], doi: "10.1/zot", year: 2023 };
    const full = fromZoteroItem({ itemKey: "Z1", ...input }, {
      libraryType: "user",
    });
    const keyOnly = zoteroBucketKeyFor(input);
    expect(keyOnly).toBe(full.bucketKey);
  });

  test("zoteroBucketKeyFor derives title+year key when DOI is absent", () => {
    const key = zoteroBucketKeyFor({ title: "Untitled", year: 2024 });
    expect(key).toBe("title:untitled#2024");
  });

  test("fromSavedSearchQuery stamps paperCount from entry.count", () => {
    const item = fromSavedSearchQuery({
      id: "h1",
      query: "neural networks",
      count: 800,
      searchFilters: { query: "neural networks", openAlexQuery: { sort: "relevance_score:desc" } },
    });
    expect(item.source).toBe("history");
    expect(item.paperCount).toBe(800);
  });

  test("fromSavedSearchQuery defaults paperCount to 0 when count is missing", () => {
    const item = fromSavedSearchQuery({
      id: "h2",
      query: "unknown",
      searchFilters: { query: "neural networks", openAlexQuery: { sort: "relevance_score:desc" } },
    });
    expect(item.paperCount).toBe(0);
  });

  test("cross-source dedup: library + zotero share doi key", () => {
    const lib = fromLibraryItem(
      libraryDoc({ openalexId: "", doi: "10.1/shared", authors: "" }),
    );
    const zot = fromZoteroItem(
      { itemKey: "Z", title: lib.title, authors: [], doi: "10.1/shared" },
      { libraryType: "user" },
    );
    // library has openalexId, so key would be openalex:... — reset that case
    // by dropping the openalexId explicitly to force DOI fallback.
    const libNoOa = fromLibraryItem(
      libraryDoc({ openalexId: "", doi: "10.1/shared", authors: "" }),
    );
    expect(libNoOa.bucketKey).toBe(zot.bucketKey);
  });
});
