// Extract from an Evidence Library's records (plans/evidence-library-sources): the setup asks the
// library once for the source's keys, as the person who started the job, keeps them, and reads the
// records by key a step at a time.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { encrypt } from "../lib/crypto";
import { setupExtractionPaperWorkpool } from "./queue/workpool.test-support";
import { personalWorkspaceOf } from "../workspaces/personal";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

const KEY = "1".repeat(64);
const RECORDS = 120;
const keyOf = (i: number) => `K${String(i).padStart(7, "0")}`;
const record = (key: string) => ({ key, revision: 1, itemType: "JournalArticle", title: `Record ${key}`, abstract: "A long enough abstract for the record to be read from it, about tutoring in primary schools.", creators: [{ name: "Ada Okafor" }], year: 2021, venue: null, url: null, crossRefs: {}, files: [] });

// The setup the start schedules waits: the test runs it itself.
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("reads a library source's records by the keys the library gave once, as the person, and lets the keys go", async () => {
  const { t, created, clerkUserId } = await createReadySetupFixture("libextract");
  const libraryId = created.libraryId;
  setupExtractionPaperWorkpool(t);
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  const { userId, workspaceId } = await t.run(async (ctx) => {
    const credential = (await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).collect()).find((row) => row.credentialKey === "library-service")!;
    await ctx.db.patch("evidenceLibraryCredentials", credential._id, { encryptedValue: encrypt("machine-secret", KEY) });
    await ctx.db.insert("featureFlags", { key: "extraction.pdf", enabled: false, updatedAt: 1 });
    await ctx.db.insert("featureFlags", { key: "extraction.enabled", enabled: true, updatedAt: 1 });
    await ctx.db.insert("featureFlags", { key: "extraction.start", enabled: true, updatedAt: 1 });
    const userId = (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique())!._id;
    await seedCreditsForTest(ctx, { userId, free: 1_000_000 });
    return { userId, workspaceId: await personalWorkspaceOf(ctx, userId) };
  });
  const asked: Array<{ path: string; body: { keys?: string[]; reader?: string } }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? "{}"));
    asked.push({ path: url.pathname, body });
    if (url.pathname === "/api/v1/openscholar/sources/resolve") return Response.json({ keys: Array.from({ length: RECORDS }, (_, i) => keyOf(i)), total: RECORDS, truncated: false });
    // The library no longer shows the first record.
    if (url.pathname === "/api/v1/openscholar/records/batch") return Response.json({ records: (body.keys as string[]).filter((key) => key !== keyOf(0)).map(record), unread: [] });
    return new Response("Not found", { status: 404 });
  }));

  const set = { kind: "evidenceLibrary" as const, libraryId, source: { readerCollection: "6f1c2a7e-0000-4000-8000-000000000001" } };
  const { jobId } = await t.mutation(internal.extraction.start.begin, { userId, workspaceId, name: "From the library", sources: [{ set, first: 1, last: 500 }], questions: [{ key: "q_0", question: "Where was it done?", type: "string" }], usePdfs: false });
  const { runEpoch } = (await t.run((ctx) => ctx.db.get("extractionJobs", jobId)))!;
  await t.action(internal.extraction.actions.setupExtractionQueueJob, { jobId, expectedEpoch: runEpoch ?? 0 });

  const papers = await t.run((ctx) => ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect());
  expect(papers.map((paper) => paper.paperKey)).toEqual(Array.from({ length: RECORDS - 1 }, (_, i) => `library:${libraryId}:${keyOf(i + 1)}`));
  expect(papers[0]).toMatchObject({ title: `Record ${keyOf(1)}`, sourceType: "evidenceLibrary", sourceId: libraryId });
  expect(await t.run((ctx) => ctx.db.get("extractionJobs", jobId))).toMatchObject({ status: "extracting", sourceType: "evidenceLibrary" });
  // Asked once for the keys, as the person; then the records a step at a time.
  expect(asked.filter((call) => call.path.endsWith("/resolve"))).toEqual([{ path: "/api/v1/openscholar/sources/resolve", body: { reader: clerkUserId, source: set.source, first: 1, last: 500 } }]);
  expect(asked.filter((call) => call.path.endsWith("/batch")).map((call) => call.body.keys?.length)).toEqual([100, 20]);
  expect(await t.run((ctx) => ctx.db.query("paperSetKeys").collect())).toEqual([]);
});
