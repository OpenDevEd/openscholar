import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { expandJobSources, readLibraryInBatches, type LibraryPaper } from "./expandSources";
import type { BucketItemInput } from "./jobSources";

const fromBrowser = (sourceRefId: string, source: "library" | "collection"): BucketItemInput => ({
  bucketKey: `key:${sourceRefId}`,
  source,
  sourceRefId,
  pdfUrl: "https://example.test/someone-elses.pdf",
  storageId: "kg2someoneelsesfile" as never,
  title: "Edited in the browser",
  authors: ["Someone Else"],
  abstract: "Not what the library holds",
});

const deps = (rows: LibraryPaper[]) => ({
  fetchPapersFromHistory: async () => [],
  resolveZoteroUserId: async () => undefined,
  readLibraryItems: async (ids: string[]) => rows.filter((row) => ids.includes(row._id)),
});

describe("a job's library and collection sources", () => {
  it("are read from the person's library, not the copy the browser sent, and gone papers are left out", async () => {
    const held: LibraryPaper = { _id: "lib1", title: "Tutoring at scale", authors: "Ada Lovelace, Grace Hopper", openalexId: "https://openalex.org/W1", abstract: "What the library holds", publicationYear: 2021, journal: "Journal of Tutoring" };

    const expanded = await expandJobSources([fromBrowser("lib1", "collection"), fromBrowser("gone", "library")], deps([held]));

    expect(expanded).toHaveLength(1);
    expect(expanded[0]!.paper).toMatchObject({ title: "Tutoring at scale", authors: ["Ada Lovelace", "Grace Hopper"], abstract: "What the library holds", publicationYear: 2021, venueName: "Journal of Tutoring", openalexId: "https://openalex.org/W1" });
    expect(expanded[0]!.bucketItem).toMatchObject({ source: "collection", title: "Tutoring at scale" });
    // A file the browser named isn't the library paper's.
    expect(expanded[0]!.paper.pdfUrl).toBeUndefined();
    expect(expanded[0]!.paper.storageId).toBeUndefined();
  });

  it("reads only the person's own papers", async () => {
    const t = convexTest(schema);
    const { ada, grace, adaPaper, gracePaper } = await t.run(async (ctx) => {
      const person = (clerkId: string) => ctx.db.insert("users", { libraryItemCount: 0, clerkId, email: `${clerkId}@test`, state: "active", createdAt: 1, updatedAt: 1 });
      const ada = await person("ada");
      const grace = await person("grace");
      const paper = (userId: typeof ada, title: string) =>
        ctx.db.insert("libraryItems", { userId, openalexId: `https://openalex.org/${title}`, title, searchableText: title, savedAt: 1, updatedAt: 1 });
      return { ada, grace, adaPaper: await paper(ada, "W1"), gracePaper: await paper(grace, "W2") };
    });

    const rows = await t.query(internal.extraction.queries.internal.ownedLibraryItems, { userId: ada, ids: [adaPaper, gracePaper, "not-an-id"] });

    expect(rows.map((row) => row._id)).toEqual([adaPaper]);
    expect(grace).toBeDefined();
  });

  it("reads a job's library papers a bounded batch at a time", async () => {
    const batches: number[] = [];
    const ids = Array.from({ length: 250 }, (_, i) => `lib${i}`);
    await readLibraryInBatches(ids, 100, async (batch) => {
      batches.push(batch.length);
      return [];
    });
    expect(batches).toEqual([100, 100, 50]);
  });
});
