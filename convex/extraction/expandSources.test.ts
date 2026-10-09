import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { expandJobSources, readLibraryInBatches, type LibraryPaper } from "./expandSources";
import type { BucketItemInput } from "./jobSources";
import { madeBy } from "../workspaces/actor.test-support";

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
    const held: LibraryPaper = { _id: "lib1", title: "Tutoring at scale", authors: ["Ada Lovelace", "Grace Hopper"], openalexId: "https://openalex.org/W1", abstract: "What the library holds", publicationYear: 2021, journal: "Journal of Tutoring", isOpenAccess: false, citedByCount: 0, workType: "preprint" };

    const expanded = await expandJobSources([fromBrowser("lib1", "collection"), fromBrowser("gone", "library")], deps([held]));

    expect(expanded).toHaveLength(1);
    expect(expanded[0]!.paper).toMatchObject({ title: "Tutoring at scale", authors: ["Ada Lovelace", "Grace Hopper"], abstract: "What the library holds", publicationYear: 2021, venueName: "Journal of Tutoring", openalexId: "https://openalex.org/W1", isOpenAccess: false, citedByCount: 0, workType: "preprint" });
    expect(expanded[0]!.bucketItem).toMatchObject({ source: "collection", title: "Tutoring at scale" });
    // A file the browser named isn't the library paper's.
    expect(expanded[0]!.paper.pdfUrl).toBeUndefined();
    expect(expanded[0]!.paper.storageId).toBeUndefined();
  });

  it("preserves unparsed names and unknown access, and takes source URLs only from the owned record", async () => {
    const held: LibraryPaper = { _id: "lib1", title: "Trial", openalexId: "W1", authorsUnparsed: "Smith, John, ليلى", pdfUrl: "https://example.test/owned.pdf" };
    const [expanded] = await expandJobSources([fromBrowser("lib1", "library")], deps([held]));
    expect(expanded.paper).toMatchObject({ authors: [], authorsUnparsed: "Smith, John, ليلى", pdfUrl: held.pdfUrl });
    expect(expanded.paper.isOpenAccess).toBeUndefined();
    expect(expanded.paper.storageId).toBeUndefined();
  });

  it("reads only the papers in the person's own workspace", async () => {
    const t = convexTest(schema);
    const { ada, grace, adaPaper, gracePaper, labPaper } = await t.run(async (ctx) => {
      const person = (clerkId: string) => ctx.db.insert("users", { clerkId, email: `${clerkId}@test`, state: "active", createdAt: 1, updatedAt: 1 });
      const ada = await person("ada");
      const grace = await person("grace");
      const paper = async (userId: typeof ada, title: string) =>
        ctx.db.insert("libraryItems", { ...(await madeBy(ctx, userId)), openalexId: `https://openalex.org/${title}`, title, searchableText: title, savedAt: 1, updatedAt: 1 });
      // One Ada saved in an organization's workspace is that workspace's, not hers.
      const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
      const lab = await ctx.db.insert("workspaces", { kind: "organization", organizationId });
      const labPaper = await ctx.db.insert("libraryItems", { workspaceId: lab, createdBy: ada, openalexId: "https://openalex.org/W3", title: "W3", searchableText: "W3", savedAt: 1, updatedAt: 1 });
      return { ada, grace, adaPaper: await paper(ada, "W1"), gracePaper: await paper(grace, "W2"), labPaper };
    });

    const rows = await t.query(internal.extraction.queries.internal.ownedLibraryItems, { userId: ada, ids: [adaPaper, gracePaper, labPaper, "not-an-id"] });

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
