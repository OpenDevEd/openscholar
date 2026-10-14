// Extract from an Evidence Library's records (plans/evidence-library-sources): the setup asks the
// library once for the source's keys, as the person who started the job, keeps them, and reads the
// records by key a step at a time.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { SERVER_MODEL_SLUG } from "../ai/config";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { encrypt } from "../lib/crypto";
import { setupExtractionPaperWorkpool } from "./queue/workpool.test-support";
import { personalWorkspaceOf } from "../workspaces/personal";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { convexTest } from "convex-test";
import schema from "../schema";
import { madeBy } from "../workspaces/actor.test-support";

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

it("saves a library record once when another source brings the same paper, matched by any identifier they share", async () => {
  const t = convexTest(schema);
  const jobId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "same", email: "same@test", state: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("featureFlags", { key: "extraction.pdf", enabled: false, updatedAt: 1 });
    return await ctx.db.insert("extractionJobs", { ...(await madeBy(ctx, userId)), name: "Same", status: "pending", runEpoch: 0, setup: { position: 0, read: 0, papers: 0, processable: 0 }, createdAt: 1, updatedAt: 1 });
  });
  const abstract = "A long enough abstract for the paper to be read from it, about tutoring in primary schools.";
  const step = async (papers: object[]) => {
    const { setup } = (await t.run((ctx) => ctx.db.get("extractionJobs", jobId)))!;
    await t.mutation(internal.extraction.mutations.papers.createPaperRecords, { jobId, papers: papers as never, setup: { expectedEpoch: 0, next: { ...setup!, position: setup!.position + 1 } } });
  };
  await step([{ paper: "openalex:W1", title: "Tutoring at scale", publicationYear: 2021, doi: "10.1/abc", abstract, sourceType: "history", sourceId: "s" }]);
  // The library knows the record by its DOI only; another of its records is a different paper with the same title.
  await step([
    { paper: "library:r1:AAAAAAAA", crossRefs: { doi: "10.1/abc" }, doi: "10.1/abc", title: "Tutoring at Scale", publicationYear: 2021, abstract, sourceType: "evidenceLibrary", sourceId: "r1" },
    { paper: "library:r1:BBBBBBBB", crossRefs: { doi: "10.1/other" }, doi: "10.1/other", title: "Tutoring at scale", publicationYear: 2021, abstract, sourceType: "evidenceLibrary", sourceId: "r1" },
  ]);
  const papers = await t.run((ctx) => ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect());
  expect(papers.map((paper) => paper.paperKey).sort()).toEqual(["library:r1:BBBBBBBB", "openalex:W1"]);
  expect((await t.run((ctx) => ctx.db.get("extractionJobs", jobId)))?.setup).toMatchObject({ papers: 2, processable: 2 });
});

it("keeps and drops a library source's keys only for the setup run going on", async () => {
  const t = convexTest(schema);
  const job = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "runs", email: "runs@test", state: "active", createdAt: 1, updatedAt: 1 });
    return await ctx.db.insert("extractionJobs", { ...(await madeBy(ctx, userId)), name: "Runs", status: "pending", runEpoch: 1, setup: { position: 0, read: 0, papers: 0, processable: 0 }, createdAt: 1, updatedAt: 1 });
  });
  const kept = () => t.run((ctx) => ctx.db.query("paperSetKeys").collect());
  // A run that was paused and set off again since keeps nothing, and its failure leaves the new run's keys alone.
  expect(await t.mutation(internal.paperSets.libraryKeys.keep, { job, epoch: 0, part: 0, from: 0, keys: ["AAAAAAAA"] })).toBe(false);
  expect(await t.mutation(internal.paperSets.libraryKeys.keep, { job, epoch: 1, part: 0, from: 0, keys: ["BBBBBBBB"] })).toBe(true);
  await t.mutation(internal.paperSets.libraryKeys.dropRun, { job, epoch: 0 });
  expect((await kept()).map((page) => page.keys)).toEqual([["BBBBBBBB"]]);
  // A job stopped while the library answered keeps nothing either.
  await t.run((ctx) => ctx.db.patch("extractionJobs", job, { status: "cancelled" }));
  expect(await t.mutation(internal.paperSets.libraryKeys.keep, { job, epoch: 1, part: 1, from: 0, keys: ["CCCCCCCC"] })).toBe(false);
  await t.mutation(internal.paperSets.libraryKeys.dropRun, { job, epoch: 1 });
  expect(await kept()).toEqual([]);
});

it("a screening's copy that takes a paper's place brings its identifiers, so a later copy finds it by them", async () => {
  const t = convexTest(schema);
  const jobId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "moved", email: "moved@test", state: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("featureFlags", { key: "extraction.pdf", enabled: false, updatedAt: 1 });
    return await ctx.db.insert("extractionJobs", { ...(await madeBy(ctx, userId)), name: "Moved", status: "pending", runEpoch: 0, setup: { position: 0, read: 0, papers: 0, processable: 0 }, createdAt: 1, updatedAt: 1 });
  });
  const abstract = "A long enough abstract for the paper to be read from it, about tutoring in primary schools.";
  const step = async (papers: object[]) => {
    const { setup } = (await t.run((ctx) => ctx.db.get("extractionJobs", jobId)))!;
    await t.mutation(internal.extraction.mutations.papers.createPaperRecords, { jobId, papers: papers as never, setup: { expectedEpoch: 0, next: { ...setup!, position: setup!.position + 1 } } });
  };
  await step([{ paper: "library:r1:AAAAAAAA", crossRefs: { doi: "10.1/abc" }, doi: "10.1/abc", title: "Tutoring at scale", publicationYear: 2021, abstract, sourceType: "evidenceLibrary", sourceId: "r1" }]);
  await step([{ paper: "library:r1:AAAAAAAA", crossRefs: { openalexId: "W1", doi: "10.1/abc" }, doi: "10.1/abc", title: "Tutoring at scale", publicationYear: 2021, abstract, sourceType: "screening", sourceId: "job", screeningRevision: "r1" }]);
  // OpenAlex's copy, under another title and with no DOI, is the same paper.
  await step([{ paper: "openalex:W1", title: "Tutoring at Scale: a trial", publicationYear: 2021, abstract, sourceType: "history", sourceId: "s" }]);
  const papers = await t.run((ctx) => ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect());
  expect(papers.map((paper) => [paper.paperKey, paper.sourceType])).toEqual([["library:r1:AAAAAAAA", "screening"]]);
});

it("refuses to start on a library source the person can no longer read, or one that holds nothing, before any job is made", async () => {
  const { t, created, clerkUserId } = await createReadySetupFixture("libextract-refused");
  const libraryId = created.libraryId;
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  await t.run(async (ctx) => {
    const credential = (await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).collect()).find((row) => row.credentialKey === "library-service")!;
    await ctx.db.patch("evidenceLibraryCredentials", credential._id, { encryptedValue: encrypt("machine-secret", KEY) });
    await ctx.db.insert("featureFlags", { key: "extraction.pdf", enabled: false, updatedAt: 1 });
    await ctx.db.insert("featureFlags", { key: "extraction.enabled", enabled: true, updatedAt: 1 });
    await ctx.db.insert("featureFlags", { key: "extraction.start", enabled: true, updatedAt: 1 });
    await ctx.db.insert("models", { modelId: SERVER_MODEL_SLUG, name: "Server model", provider: "test", inputPricePerMillion: 0.1, outputPricePerMillion: 0.5, costMarkup: 1.3, isServed: true, sortOrder: 1, supportedParameters: [], syncedAt: 1, createdAt: 1, updatedAt: 1 });
    await seedCreditsForTest(ctx, { userId: (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique())!._id, free: 1_000_000 });
  });
  // The collection was made private since the form opened; the search finds nothing now.
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (new URL(String(input)).pathname !== "/api/v1/openscholar/sources/resolve") return new Response("Not found", { status: 404 });
    return "search" in body.source ? Response.json({ keys: [], total: 0, truncated: false }) : Response.json({ error: "private", message: "This collection is private." }, { status: 403 });
  }));
  const person = t.withIdentity({ subject: clerkUserId });
  const workspaceId = (await person.query(api.workspaces.queries.personal, {}))!;
  const extract = (source: { readerCollection: string } | { search: string }) =>
    person.action(api.extraction.start.extract, { workspaceId, name: "From the library", set: { kind: "evidenceLibrary", libraryId, source }, first: 1, last: 1, questions: [{ question: "Where was it done?", type: "string" }] });
  await expect(extract({ readerCollection: "6f1c2a7e-0000-4000-8000-000000000001" })).rejects.toThrow(/private/);
  await expect(extract({ search: "search=zzzz" })).rejects.toThrow(/holds no records/);
  expect(await t.run((ctx) => ctx.db.query("extractionJobs").collect())).toEqual([]);
});
