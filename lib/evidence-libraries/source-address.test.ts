import { describe, expect, it } from "vitest";
import { parseSourceAddress } from "./source-address";

describe("a pasted library address as a source", () => {
  it("reads the search page as a search with its filters and sort, a whole library or one collection", () => {
    expect(parseSourceAddress("https://aied.example.org/lib?search=tutoring&type=journalArticle&sort=desc&page=3&referrer=x")).toEqual({
      origin: "https://aied.example.org",
      source: { search: "search=tutoring&type=journalArticle&sort=desc" },
    });
    expect(parseSourceAddress("aied.example.org/lib")).toEqual({ origin: "https://aied.example.org", source: { library: true } });
    expect(parseSourceAddress("https://aied.example.org/")).toEqual({ origin: "https://aied.example.org", source: { library: true } });
    expect(parseSourceAddress("https://aied.example.org/lib?collections=ABCD1234&sort=asc")).toEqual({ origin: "https://aied.example.org", source: { libraryCollection: "ABCD1234" } });
    // Two collections, or a collection with words, are a search.
    expect(parseSourceAddress("https://aied.example.org/lib?collections=ABCD1234,EFGH5678")).toMatchObject({ source: { search: "collections=ABCD1234%2CEFGH5678" } });
  });

  it("reads a record's page as that record and a reader's collection as that collection, in any language", () => {
    expect(parseSourceAddress("https://aied.example.org/fr/lib/27BGDU89")).toEqual({ origin: "https://aied.example.org", source: { records: ["27BGDU89"] } });
    expect(parseSourceAddress("https://aied.example.org/profile/reader-1?collectionId=6f1c")).toEqual({ origin: "https://aied.example.org", source: { readerCollection: "6f1c" } });
    expect(parseSourceAddress("https://aied.example.org/en/profile/reader-1?collectionId=6f1c&search=coaching")).toMatchObject({ source: { search: "search=coaching", readerCollection: "6f1c" } });
  });

  it("says why it can't read an address", () => {
    expect(parseSourceAddress("https://aied.example.org/profile/reader-1")).toMatchObject({ error: expect.stringMatching(/bookmarks/) });
    expect(parseSourceAddress("https://aied.example.org/digests/2026-10")).toMatchObject({ error: expect.any(String) });
    expect(parseSourceAddress("ftp://aied.example.org/lib")).toMatchObject({ error: expect.any(String) });
    expect(parseSourceAddress("https://aied.example.org/lib/lowercase")).toMatchObject({ error: expect.any(String) });
  });
});
