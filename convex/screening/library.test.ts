// Screen all on an Evidence Library's records (plans/evidence-library-sources): the library turns
// the source into keys once, as the person may read it, and the job reads those records by key.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { SERVER_MODEL_SLUG } from "../ai/config";
import { encrypt } from "../lib/crypto";
import { setupScreeningWorkpool } from "./workpool.test-support";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

const KEY = "1".repeat(64);
const questions = [{ key: "q1", question: "Randomized?" }];
const scoringConfig = { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], starThresholds: [{ minScore: 1, stars: 5 }], minimumScore: 1 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const record = (key: string, extra: Record<string, unknown> = {}) => ({ key, revision: 1, itemType: "JournalArticle", title: `Record ${key}`, abstract: "Tutors help", creators: [{ name: "Ada Okafor" }], year: 2021, venue: "A journal", url: null, crossRefs: {}, files: [], ...extra });

it("screens a library collection by the keys the library gave, as the person who started it", async () => {
  const { t, created, clerkUserId } = await createReadySetupFixture("libscreen");
  const libraryId = created.libraryId;
  setupScreeningWorkpool(t);
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  await t.run(async (ctx) => {
    const credential = (await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).collect()).find((row) => row.credentialKey === "library-service")!;
    await ctx.db.patch("evidenceLibraryCredentials", credential._id, { encryptedValue: encrypt("machine-secret", KEY) });
    const userId = (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique())!._id;
    await seedCreditsForTest(ctx, { userId, free: 100_000 });
    await ctx.db.insert("models", { modelId: SERVER_MODEL_SLUG, name: "Server model", provider: "test", inputPricePerMillion: 0.1, outputPricePerMillion: 0.5, costMarkup: 1.3, isServed: true, sortOrder: 1, supportedParameters: [], syncedAt: 1, createdAt: 1, updatedAt: 1 });
  });
  const calls: Array<{ path: string; body: unknown; headers: Record<string, string> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path: url.pathname, body, headers: init?.headers as Record<string, string> });
    if (url.pathname === "/api/v1/openscholar/sources/resolve") return Response.json({ keys: ["AAAAAAAA", "BBBBBBBB", "CCCCCCCC"], total: 3, truncated: false });
    if (url.pathname === "/api/v1/openscholar/records/batch") {
      const keys = body.keys as string[];
      // The library no longer shows one of them.
      return Response.json({ records: keys.filter((key) => key !== "BBBBBBBB").map((key) => (key === "AAAAAAAA" ? record(key, { crossRefs: { openalexId: "W7", doi: "10.1000/abc" }, files: [{ attachmentKey: "PDFAAAAA", filename: "a.pdf", contentType: "application/pdf" }] }) : record(key))), unread: [] });
    }
    return new Response("Not found", { status: 404 });
  }));
  const person = t.withIdentity({ subject: clerkUserId });

  const set = { kind: "evidenceLibrary" as const, libraryId, source: { readerCollection: "6f1c2a7e-0000-4000-8000-000000000001" } };
  const { jobId } = await person.action(api.screening.start.screen, { set, first: 1, last: 10, questions, scoringConfig, saveTo: { kind: "none" } });
  // The keys are kept for the job before it reads any, the range cut to what the source holds.
  expect(await t.run((ctx) => ctx.db.query("paperSetKeys").collect())).toMatchObject([{ job: jobId, page: 0, keys: ["AAAAAAAA", "BBBBBBBB", "CCCCCCCC"] }]);
  await t.action(internal.screening.start.read, { jobId });

  const results = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect());
  expect(results.map((result) => result.paperKey)).toEqual([`library:${libraryId}:AAAAAAAA`, `library:${libraryId}:CCCCCCCC`]);
  expect(results[0]).toMatchObject({ title: "Record AAAAAAAA", authors: ["Ada Okafor"], publicationYear: 2021, venue: "A journal", doi: "10.1000/abc", crossRefs: { openalexId: "W7", doi: "10.1000/abc" } });
  expect(results[0]!.pdfUrl).toMatch(/\/api\/item\/AAAAAAAA\/download\/PDFAAAAA$/);
  const job = await t.run((ctx) => ctx.db.get("screeningJobs", jobId));
  expect(job).toMatchObject({ label: expect.any(String), last: 3 });

  // The library was asked as the person, with its credential and the contract version.
  const resolve = calls.find((call) => call.path === "/api/v1/openscholar/sources/resolve")!;
  expect(resolve.body).toEqual({ reader: clerkUserId, source: set.source, first: 1, last: 10 });
  expect(resolve.headers).toMatchObject({ Authorization: "Bearer machine-secret", "OpenScholar-Contract": "1" });
  // Read, the keys go.
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.query("paperSetKeys").collect())).toEqual([]);
});

it("refuses a library that isn't running, and says why the library refused a private collection", async () => {
  const { t, created, clerkUserId } = await createReadySetupFixture("libscreen2");
  const libraryId = created.libraryId;
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  await t.run(async (ctx) => {
    const credential = (await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).collect()).find((row) => row.credentialKey === "library-service")!;
    await ctx.db.patch("evidenceLibraryCredentials", credential._id, { encryptedValue: encrypt("machine-secret", KEY) });
    const userId = (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique())!._id;
    await seedCreditsForTest(ctx, { userId, free: 100_000 });
  });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "private", message: "This collection is private." }, { status: 403 })));
  const person = t.withIdentity({ subject: clerkUserId });
  const set = { kind: "evidenceLibrary" as const, libraryId, source: { readerCollection: "6f1c2a7e-0000-4000-8000-000000000002" } };
  await expect(person.action(api.screening.start.screen, { set, first: 1, last: 5, questions, scoringConfig, saveTo: { kind: "none" } })).rejects.toThrow(/private/);

  await t.run((ctx) => ctx.db.patch("evidenceLibraries", libraryId, { state: "disabled" }));
  await expect(person.action(api.screening.start.screen, { set, first: 1, last: 5, questions, scoringConfig, saveTo: { kind: "none" } })).rejects.toThrow(/isn't running/);
  expect(await t.run((ctx) => ctx.db.query("screeningJobs").collect())).toEqual([]);
});
