import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

it("migrates retained authors without crossing owners or guessing, and guards rollback", async () => {
  const t = convexTest(schema);
  const seeded = await t.run(async (ctx) => {
    const person = (clerkId: string) => ctx.db.insert("users", { clerkId, email: `${clerkId}@test`, state: "active", libraryItemCount: 0, createdAt: 1, updatedAt: 1 });
    const owner = await person("owner"), foreign = await person("foreign");
    const job = async (userId: typeof owner) => {
      const screeningId = await ctx.db.insert("screenings", { userId, version: 0, createdAt: 1 });
      return ctx.db.insert("screeningJobs", { userId, screeningId, status: "completed", totalPapers: 4, questions: [], scoringConfig: { rules: [], starThresholds: [] }, createdAt: 1, updatedAt: 1 });
    };
    const ownedJob = await job(owner), foreignJob = await job(foreign);
    const result = (jobId: typeof ownedJob, id: string, authors: string[]) => ctx.db.insert("screeningResults", { jobId, openalexId: id, title: id, authors, venue: "Retained journal", citedByCount: 0, status: "completed", createdAt: 1 });
    await result(ownedJob, "https://openalex.org/W1", ["Smith, Jr., John", "ليلى"]);
    await result(foreignJob, "https://openalex.org/W2", ["Smith", "John"]);
    await result(ownedJob, "https://openalex.org/W3", ["Smith", "John"]);
    await result(ownedJob, "https://openalex.org/W3", ["Smith, John"]);
    const saved = (openalexId: string, authors?: string, paperData?: string) => ctx.db.insert("libraryItems", { userId: owner, openalexId, title: openalexId, authors, paperData, rating: 4, searchableText: `${openalexId} ${authors ?? ""}`, savedAt: 10, updatedAt: 20 });
    const retained = await saved("W1", "Smith, Jr., John, ليلى");
    const foreignOnly = await saved("W2", "Smith, John");
    const ambiguous = await saved("W3", "Smith, John");
    const raw = await saved("W4", "Doe, Jane", JSON.stringify({ authorships: [{ author: { display_name: "Doe, Jane" } }] }));
    await saved("W5");
    const longAuthors = Array.from({ length: 101 }, (_, i) => `Author ${i}`);
    const long = await saved("W6", longAuthors.join(", "), JSON.stringify({ authorships: longAuthors.map(display_name => ({ author: { display_name } })) }));
    const removal = await ctx.db.insert("libraryRemovals", { userId: owner, item: { openalexId: "W4", title: "Removed", authors: "Doe, Jane", paperData: JSON.stringify({ authorships: [{ author: { display_name: "Doe, Jane" } }] }), searchableText: "Removed Doe, Jane", savedAt: 1, updatedAt: 2 }, collectionIds: [], expiresAt: Date.now() + 100_000 });
    return { retained, foreignOnly, ambiguous, raw, removal, long, longAuthors };
  });
  const migrate = async () => {
    for (const fn of [internal.migrations.paperMetadata.papers, internal.migrations.paperMetadata.removals]) {
      let cursor: string | null = null;
      for (;;) {
        const page: { isDone: boolean; continueCursor: string } = await t.mutation(fn, { cursor, dryRun: false, oneBatchOnly: true });
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
  };
  const before = await t.run((ctx) => ctx.db.get("libraryItems", seeded.retained));
  await expect(t.mutation(internal.migrations.paperMetadata.papers, { cursor: null, dryRun: true, oneBatchOnly: true })).rejects.toThrow();
  expect(await t.run((ctx) => ctx.db.get("libraryItems", seeded.retained))).toEqual(before);
  expect(await t.run((ctx) => ctx.db.query("paperMetadataChanges").take(10))).toEqual([]);
  await t.withIdentity({ subject: "owner" }).mutation(api.library.mutations.saveToLibrary, { openalexId: "W1", title: "Partial save before migration" });
  await migrate();
  expect(await t.action(internal.migrations.paperMetadata.verify, {})).toEqual({ library: { total: 6, remaining: 0, arrays: 2, unparsed: 3, missing: 1 }, removals: { total: 1, remaining: 0, arrays: 1, unparsed: 0, missing: 0 } });
  expect(await t.run((ctx) => ctx.db.get("libraryItems", seeded.retained))).toMatchObject({ authors: ["Smith, Jr., John", "ليلى"], journal: "Retained journal", citedByCount: 0, rating: 4, savedAt: 10 });
  const oversized = await t.run((ctx) => ctx.db.get("libraryItems", seeded.long));
  expect(oversized!.authors).toBeUndefined();
  expect(oversized!.authorsUnparsed).toBe(seeded.longAuthors.join(", "));
  for (const id of [seeded.foreignOnly, seeded.ambiguous]) {
    const item = await t.run((ctx) => ctx.db.get("libraryItems", id));
    expect(item!.authors).toBeUndefined();
    expect(item!.authorsUnparsed).toBe("Smith, John");
  }
  const manifest = await t.run((ctx) => ctx.db.query("paperMetadataChanges").take(10));
  expect(manifest).toHaveLength(7);
  await migrate();
  expect(await t.run((ctx) => ctx.db.query("paperMetadataChanges").take(10))).toEqual(manifest);
  await t.run((ctx) => ctx.db.patch("libraryItems", seeded.retained, { rating: 5 }));
  expect(await t.mutation(internal.migrations.paperMetadata.rollback, { changeId: manifest.find((row) => row.recordId === seeded.retained)!._id })).toBe(true);
  expect(await t.run((ctx) => ctx.db.get("libraryItems", seeded.retained))).toMatchObject({ authorsUnparsed: "Smith, Jr., John, ليلى", rating: 5 });
  await t.run((ctx) => ctx.db.patch("libraryItems", seeded.raw, { authors: ["Later correction"] }));
  await expect(t.mutation(internal.migrations.paperMetadata.rollback, { changeId: manifest.find((row) => row.recordId === seeded.raw)!._id })).rejects.toThrow(/changed after migration/);
});
