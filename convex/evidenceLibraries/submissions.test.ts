// Your submissions (OS-29, #1124): Openscholar records a paper someone sent to a community, and the community tells it
// where the paper got to (new-el #778).
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { purgeSubmissions } from "./submissions";

const modules = import.meta.glob("/convex/**/*.ts");
const token = "els_" + "b".repeat(43);

it("lists the papers someone sent, and takes where each stands from the community that holds it, in order", async () => {
  const t = convexTest(schema, modules);
  const { libraryId, userId, workspaceId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "sender", email: "sender@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const workspaceId = await ctx.db.insert("workspaces", { kind: "personal", userId });
    const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId, name: "Teacher Education", slug: "teachers", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: createHash("sha256").update(token).digest("hex"), validationState: "valid", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    return { libraryId, userId, workspaceId };
  });
  const paper = { title: "Coaching teachers", authors: "Amina Yusuf", year: 2021, openalexId: "W60", doi: "10.1000/w60" };
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId, libraryId, requestId: "r1", papers: [{ itemKey: "PAPER001", ...paper, status: "queued" }] });

  const tell = async (generation: number, status: string, note: string | null, credential = token, clerkUserId = "sender") => {
    const response = await t.fetch("/api/v1/evidence-libraries/paper-submissions", {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contractVersion: 1, idempotencyKey: `${libraryId}:PAPER001:${generation}`, libraryId, itemKey: "PAPER001", generation, clerkUserId, status, note, at: "2026-11-08T12:00:00Z" }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  expect((await tell(2, "returned", "Outside this community's focus")).body).toEqual({ idempotencyKey: `${libraryId}:PAPER001:2`, generation: 2 });
  // An earlier change that arrives late changes nothing; a repeat of the last one is answered the same.
  await tell(1, "published", null);
  expect((await tell(2, "returned", "Outside this community's focus")).status).toBe(200);
  expect((await tell(3, "published", null, "els_" + "c".repeat(43))).status).toBe(401);
  // Someone else sends it again: waiting is their submission's word, and doesn't change the first sender's.
  const other = await t.run((ctx) => ctx.db.insert("users", { clerkId: "other", email: "other@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId: other, libraryId, requestId: "r2", papers: [{ itemKey: "PAPER001", ...paper, status: "queued" }] });
  await tell(2, "queued", null, token, "other");
  expect((await t.withIdentity({ subject: "other" }).query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page[0]).toMatchObject({ status: "queued" });

  const sender = t.withIdentity({ subject: "sender" });
  const mine = await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } });
  expect(mine.page).toMatchObject([{ itemKey: "PAPER001", ...paper, status: "returned", note: "Outside this community's focus", community: { libraryId, name: "Teacher Education" } }]);
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 }, status: "queued" })).page).toEqual([]);
  // Add to community lists the community as recent, with the person's role there (its owner: it's in their own workspace), and the paper as returned there.
  expect(await sender.query(api.evidenceLibraries.submissions.recentCommunities, {})).toMatchObject([{ libraryId, name: "Teacher Education", role: "owner" }]);
  expect(await sender.query(api.evidenceLibraries.submissions.sentTo, { openalexId: "W60" })).toEqual([{ libraryId, status: "returned" }]);
  // Searched by its title or its community's name, and counted by status for the filter.
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 }, search: "teacher education" })).page.map((row) => row.itemKey)).toEqual(["PAPER001"]);
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 }, search: "astronomy" })).page).toEqual([]);
  expect(await sender.query(api.evidenceLibraries.submissions.counts, {})).toEqual({ queued: 0, published: 0, returned: 1, all: 1, capped: false });
  // The assistant reads the same list for them, from a chat in any of their workspaces, and only theirs.
  expect((await t.query(internal.evidenceLibraries.assistant.submissionsForAssistant, { userId, workspaceId, status: "returned" })).page).toMatchObject([{ itemKey: "PAPER001", status: "returned", note: "Outside this community's focus" }]);

  // Sent again, it waits for review again, and the community's next word applies.
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId, libraryId, requestId: "r3", papers: [{ itemKey: "PAPER001", ...paper, status: "queued" }] });
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page[0]).toMatchObject({ status: "queued", note: null });
  await tell(3, "published", null);
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page[0]).toMatchObject({ status: "published" });
  // Published, it's published for both.
  expect((await t.withIdentity({ subject: "other" }).query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page[0]).toMatchObject({ status: "published" });
  // The request that sent it again, replayed, leaves what the community said since.
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId, libraryId, requestId: "r3", papers: [{ itemKey: "PAPER001", ...paper, status: "queued" }] });
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page[0]).toMatchObject({ status: "published" });

  // Renamed, the community is found by its new name.
  await t.run((ctx) => ctx.db.patch("evidenceLibraries", libraryId, { name: "Teacher Learning" }));
  await t.mutation(internal.evidenceLibraries.submissions.refreshCommunityName, { libraryId, cursor: null });
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 }, search: "teacher learning" })).page.map((row) => row.itemKey)).toEqual(["PAPER001"]);

  // Withdrawn, it's no longer listed; sent again, a late repeat of that withdrawal leaves the new submission.
  await tell(4, "withdrawn", null);
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([]);
  // Asked for, the assistant lists it as withdrawn.
  expect((await t.query(internal.evidenceLibraries.assistant.submissionsForAssistant, { userId, workspaceId, status: "withdrawn" })).page).toMatchObject([{ itemKey: "PAPER001", status: "withdrawn" }]);
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId, libraryId, requestId: "r4", papers: [{ itemKey: "PAPER001", ...paper, status: "queued" }] });
  await tell(4, "withdrawn", null);
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page).toMatchObject([{ status: "queued" }]);
});

it("holds the community's word on a paper that comes before Openscholar recorded it, and applies it then", async () => {
  const t = convexTest(schema, modules);
  const { libraryId, userId, workspaceId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "early", email: "early@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const workspaceId = await ctx.db.insert("workspaces", { kind: "personal", userId });
    const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId, name: "Early Grades", slug: "early", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: createHash("sha256").update(token).digest("hex"), validationState: "valid", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    return { libraryId, userId, workspaceId };
  });
  const response = await t.fetch("/api/v1/evidence-libraries/paper-submissions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ contractVersion: 1, idempotencyKey: `${libraryId}:EARLY001:1`, libraryId, itemKey: "EARLY001", generation: 1, clerkUserId: "early", status: "published", note: null, at: "2026-11-08T12:00:00Z" }),
  });
  expect(response.status).toBe(200);
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId, libraryId, requestId: "e1", papers: [{ itemKey: "EARLY001", title: "Phonics", authors: "", year: 2020, openalexId: "W70", doi: null, status: "queued" }] });
  const [row] = (await t.withIdentity({ subject: "early" }).query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page;
  // Withdrawn from the community's own workspace, which is theirs.
  expect(row).toMatchObject({ itemKey: "EARLY001", status: "published", workspaceId });
  expect(await t.run((ctx) => ctx.db.query("pendingSubmissionStatus").collect())).toEqual([]);
});

it("removes a deleted account's submissions", async () => {
  const t = convexTest(schema, modules);
  const { userId, libraryId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "gone", email: "gone@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const workspaceId = await ctx.db.insert("workspaces", { kind: "personal", userId });
    const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId, name: "Gone", slug: "gone", state: "active", createdByClerkUserId: "gone", updatedByClerkUserId: "gone", createdAt: 1, updatedAt: 1 });
    return { userId, libraryId };
  });
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId, libraryId, requestId: "g1", papers: [{ itemKey: "GONE0001", title: "Phonics", authors: "", year: null, openalexId: null, doi: "10.1000/gone", status: "queued" }] });
  expect(await t.run((ctx) => purgeSubmissions(ctx, userId))).toBe(true);
  expect(await t.run((ctx) => ctx.db.query("paperSubmissions").collect())).toEqual([]);
});

it("makes a paper sent from the community's own site the person's submission, from the community's first word on it", async () => {
  const t = convexTest(schema, modules);
  const { libraryId, userId, workspaceId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "reader", email: "reader@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const workspaceId = await ctx.db.insert("workspaces", { kind: "personal", userId });
    const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId, name: "Teacher Education", slug: "teachers", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: createHash("sha256").update(token).digest("hex"), validationState: "valid", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    return { libraryId, userId, workspaceId };
  });
  const paper = { title: "Coaching teachers", authors: "Amina Yusuf", year: 2021, openalexId: "W60", doi: "10.1000/w60" };
  const tell = (generation: number, status: string, withPaper: boolean) =>
    t.fetch("/api/v1/evidence-libraries/paper-submissions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contractVersion: 1, idempotencyKey: `${libraryId}:SITE0001:${generation}`, libraryId, itemKey: "SITE0001", generation, clerkUserId: "reader", status, note: null, at: "2026-11-08T12:00:00Z", ...(withPaper ? { paper } : {}) }),
    });
  // Published before its first word arrives: held, then applied once the paper is theirs.
  expect((await tell(2, "published", true)).status).toBe(200);
  expect((await tell(1, "queued", true)).status).toBe(200);
  const mine = await t.query(internal.evidenceLibraries.assistant.submissionsForAssistant, { userId, workspaceId });
  expect(mine.page).toMatchObject([{ itemKey: "SITE0001", ...paper, status: "published", community: { libraryId } }]);
});

it("keeps a community's word that comes before Openscholar's own send finishes, and makes a first word of published the sender's too", async () => {
  const t = convexTest(schema, modules);
  const { libraryId, userId, workspaceId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "racer", email: "racer@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const workspaceId = await ctx.db.insert("workspaces", { kind: "personal", userId });
    const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId, name: "Teacher Education", slug: "teachers", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: createHash("sha256").update(token).digest("hex"), validationState: "valid", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    return { libraryId, userId, workspaceId };
  });
  const paper = { title: "Coaching teachers", authors: "Amina Yusuf", year: 2021, openalexId: "W60", doi: "10.1000/w60" };
  const tell = (itemKey: string, generation: number, status: string, requestId: string) =>
    t.fetch("/api/v1/evidence-libraries/paper-submissions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contractVersion: 1, idempotencyKey: `${libraryId}:${itemKey}:${generation}`, libraryId, itemKey, generation, clerkUserId: "racer", status, note: status === "returned" ? "Out of scope" : null, at: "2026-11-08T12:00:00Z", paper: { ...paper, requestId } }),
    });
  const mine = async () => (await t.query(internal.evidenceLibraries.assistant.submissionsForAssistant, { userId, workspaceId })).page.map(({ itemKey, status }) => ({ itemKey, status }));

  // Returned before Openscholar's request that sent it records it: the return stands.
  await tell("RACE0001", 1, "queued", "r9");
  await tell("RACE0001", 2, "returned", "r9");
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId, libraryId, requestId: "r9", papers: [{ itemKey: "RACE0001", ...paper, status: "queued" }] });
  // Approved before the word that it waits was sent: published is the first word, and it's theirs.
  await tell("RACE0002", 2, "published", "r10");
  expect((await mine()).sort((a, b) => a.itemKey.localeCompare(b.itemKey))).toEqual([{ itemKey: "RACE0001", status: "returned" }, { itemKey: "RACE0002", status: "published" }]);
});
