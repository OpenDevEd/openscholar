/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "../schema";
import { organizationWorkspaceOf } from "../workspaces/personal";
import { grantPlanFeaturesForTest } from "../billing/billing.test-support";
import { EVIDENCE_LIBRARIES_FEATURE } from "../../lib/billing/plans";
import { internal } from "../_generated/api";
import { requestScreeningGrade } from "./screeningRequests";

const modules = import.meta.glob("/convex/**/*.ts");
const token = "els_" + "a".repeat(43);

const upToDate = {
  key: "zotero-42",
  provider: "zotero",
  state: "succeeded",
  searchable: 300,
  searchFailed: 0,
  changed: 14,
  lastSuccessAt: "2026-09-27T12:08:00.000Z",
  issues: { pdf_unavailable: 3 },
};
// The runtime does not count searchable records mid-import.
const importing = {
  ...upToDate,
  searchable: null,
  state: "running",
  phase: "import",
  done: 120,
  total: 300,
  startedAt: "2026-09-27T12:09:00.000Z",
  minutesLeft: 2,
};

async function setup() {
  const t = convexTest(schema, modules);
  const libraryId = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "status-org", name: "Library", slug: "library", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    await grantPlanFeaturesForTest(ctx, organizationId, [EVIDENCE_LIBRARIES_FEATURE]);
    const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId: await organizationWorkspaceOf(ctx, organizationId), name: "Library", slug: "library", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: createHash("sha256").update(token).digest("hex"), validationState: "valid", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    return libraryId;
  });
  const post = (observedAt: string, sources: unknown[], credential = token, extra: Record<string, unknown> = {}) =>
    t.fetch("/api/v1/evidence-libraries/source-status", {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, libraryId, observedAt, sources, ...extra }),
    });
  const saved = () => t.run((ctx) => ctx.db.query("evidenceLibrarySourceStatus").collect());
  return { t, libraryId, post, saved };
}

it("keeps the newest report, so a late or retried older one never moves status backwards", async () => {
  const { post, saved } = await setup();

  expect((await post("2026-09-27T12:10:00.000Z", [importing])).status).toBe(200);
  expect((await post("2026-09-27T12:10:05.000Z", [upToDate])).status).toBe(200);
  expect((await post("2026-09-27T12:10:00.000Z", [importing])).status).toBe(200);

  expect(await saved()).toMatchObject([
    { observedAt: Date.parse("2026-09-27T12:10:05.000Z"), sources: [{ key: "zotero-42", state: "succeeded" }] },
  ]);
});

it("refuses another library's credential and a report that breaks the contract", async () => {
  const { post, saved } = await setup();

  expect((await post("2026-09-27T12:10:00.000Z", [upToDate], "els_" + "b".repeat(43))).status).toBe(401);
  expect((await post("2026-09-27T12:10:00.000Z", [{ ...upToDate, state: "exploded" }])).status).toBe(400);
  expect((await post("not a time", [upToDate])).status).toBe(400);
  expect((await post(new Date(Date.now() + 3_600_000).toISOString(), [upToDate])).status).toBe(400);
  expect((await post("2026-09-27T12:10:00.000Z", [{ ...importing, startedAt: "not a time" }])).status).toBe(400);
  expect((await post("2026-09-27T12:10:00.000Z", [{ ...importing, done: -1 }])).status).toBe(400);
  expect((await post("2026-09-27T12:10:00.000Z", [upToDate], token, { version: 2 })).status).toBe(400);
  expect(await saved()).toEqual([]);
});

it("accepts a source adding PDFs and one that stopped while adding them", async () => {
  const { post, saved } = await setup();
  const addingPdfs = { ...importing, provider: "openalex", key: "openalex-1", searchable: 300, phase: "pdfs", pdfs: { added: 90, missed: 30 } };
  const stopped = {
    ...upToDate,
    provider: "openalex",
    key: "openalex-2",
    state: "failed",
    failure: { code: "internal", details: "Storage upload failed", at: "2026-09-27T12:09:30.000Z" },
    failedIn: "pdfs",
    pdfs: { added: 90, missed: 30 },
  };

  expect((await post("2026-09-27T12:10:00.000Z", [addingPdfs, stopped])).status).toBe(200);

  expect(await saved()).toMatchObject([{ sources: [{ phase: "pdfs", pdfs: { added: 90 } }, { failedIn: "pdfs" }] }]);
});

it("refuses PDF counts that are not whole numbers from zero up", async () => {
  const { post } = await setup();
  const response = await post("2026-09-27T12:10:00.000Z", [{ ...upToDate, pdfs: { added: -1, missed: 0.5 } }]);
  expect(response.status).toBe(400);
});

it("keeps what a screening source found, and refuses screening counts that are not whole numbers from zero up", async () => {
  const { post, saved } = await setup();
  const screening = { grades: { about: 65_174, touches: 68_200, passing: 21_238, notAbout: 2_648 }, ungraded: 37, grading: { done: 12, of: 49 } };

  expect((await post("2026-09-27T12:10:00.000Z", [{ ...upToDate, screening }])).status).toBe(200);
  expect(await saved()).toMatchObject([{ sources: [{ screening: { grades: { notAbout: 2_648 }, ungraded: 37 } }] }]);
  expect((await post("2026-09-27T12:11:00.000Z", [{ ...upToDate, screening: { ...screening, ungraded: -1 } }])).status).toBe(400);
  const detail = {
    ...screening,
    subject: "Climate change adaptation in agriculture",
    examples: { about: "Drought-tolerant maize in Malawi", touches: null, passing: null, notAbout: "Corporate bond spreads" },
    reading: { title: "Heat and wheat yields", left: 120 },
  };
  expect((await post("2026-09-27T12:12:00.000Z", [{ ...upToDate, screening: detail }])).status).toBe(200);
  expect(await saved()).toMatchObject([{ sources: [{ screening: { subject: detail.subject, reading: { left: 120 } } }] }]);
  expect((await post("2026-09-27T12:13:00.000Z", [{ ...upToDate, screening: { ...detail, reading: { title: "x", left: 1.5 } } }])).status).toBe(400);
});

it("holds an owner's grading request until the library reports its subject, then sends it once", async () => {
  const { t, libraryId, post } = await setup();
  const screening = (subject: string) => ({ grades: { about: 2, touches: 0, passing: 0, notAbout: 0 }, ungraded: 2, grading: null, subject });
  const requestId = await t.run(async (ctx) => {
    const requestedBy = await ctx.db.insert("users", { clerkId: "owner", email: "owner@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    await requestScreeningGrade(ctx, { libraryId, sourceKey: upToDate.key, subject: "Urban housing policy", requestedBy });
    return (await ctx.db.query("evidenceLibraryScreeningRequests").unique())!._id;
  });
  const request = () => t.run((ctx) => ctx.db.get("evidenceLibraryScreeningRequests", requestId));
  const sends = () => t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name.endsWith("sendScreeningGrade")).length);

  // The library still screens against the old subject: the request waits.
  await post("2026-09-27T12:10:00.000Z", [{ ...upToDate, screening: screening("Climate adaptation") }]);
  expect((await request())?.sendingAt).toBeUndefined();
  expect(await sends()).toBe(0);

  // Activated, the library reports the new subject: the request goes, and a report meanwhile doesn't send it again.
  await post("2026-09-27T12:11:00.000Z", [{ ...upToDate, screening: screening("Urban housing policy") }]);
  await post("2026-09-27T12:11:05.000Z", [{ ...upToDate, screening: screening("Urban housing policy") }]);
  expect((await request())?.sendingAt).toBeTypeOf("number");
  expect(await sends()).toBe(1);

  // Taken by the library, it stays until a report shows the grading under way.
  await t.mutation(internal.evidenceLibraries.screeningRequests.settle, { requestId, outcome: "queued" });
  expect((await request())?.sentAt).toBeTypeOf("number");
  await post("2026-09-27T12:12:00.000Z", [{ ...upToDate, screening: { ...screening("Urban housing policy"), grading: { done: 0, of: 2 } } }]);
  expect(await request()).toBeNull();
});

it("keeps a grading request the library refused, with its reason", async () => {
  const { t, libraryId } = await setup();
  const requestId = await t.run(async (ctx) => {
    const requestedBy = await ctx.db.insert("users", { clerkId: "owner", email: "owner@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    await requestScreeningGrade(ctx, { libraryId, sourceKey: upToDate.key, subject: "Urban housing policy", requestedBy });
    return (await ctx.db.query("evidenceLibraryScreeningRequests").unique())!._id;
  });
  await t.mutation(internal.evidenceLibraries.screeningRequests.settle, { requestId, outcome: "refused", error: "No OpenRouter key" });
  const request = await t.run((ctx) => ctx.db.get("evidenceLibraryScreeningRequests", requestId));
  expect(request).toMatchObject({ error: "No OpenRouter key" });
  expect(request?.sendingAt).toBeUndefined();
});

it("asks a library that isn't ready again in a minute, and gives up on a request an hour old", async () => {
  const { t, libraryId } = await setup();
  const ids = await t.run(async (ctx) => {
    const requestedBy = await ctx.db.insert("users", { clerkId: "owner", email: "owner@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const fresh = await ctx.db.insert("evidenceLibraryScreeningRequests", { libraryId, sourceKey: "zotero-1", subject: "A", requestedBy, requestedAt: Date.now() });
    const old = await ctx.db.insert("evidenceLibraryScreeningRequests", { libraryId, sourceKey: "zotero-2", subject: "A", requestedBy, requestedAt: Date.now() - 2 * 60 * 60_000 });
    return { fresh, old };
  });
  await t.mutation(internal.evidenceLibraries.screeningRequests.settle, { requestId: ids.fresh, outcome: "not-ready" });
  await t.mutation(internal.evidenceLibraries.screeningRequests.settle, { requestId: ids.old, outcome: "not-ready" });
  const [fresh, old, retries] = await t.run(async (ctx) => [
    await ctx.db.get("evidenceLibraryScreeningRequests", ids.fresh),
    await ctx.db.get("evidenceLibraryScreeningRequests", ids.old),
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name.endsWith("sendScreeningGrade")).length,
  ] as const);
  expect(fresh?.sendingAt).toBeTypeOf("number");
  expect(fresh?.error).toBeUndefined();
  expect(retries).toBe(1);
  expect(old?.error).toContain("within an hour");
});

