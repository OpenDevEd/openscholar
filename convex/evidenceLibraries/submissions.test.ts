// Your submissions (OS-29, #1124): Openscholar records a paper someone sent to a community, and the community tells it
// where the paper got to (new-el #778).
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.ts");
const token = "els_" + "b".repeat(43);

it("lists the papers someone sent, and takes where each stands from the community that holds it, in order", async () => {
  const t = convexTest(schema, modules);
  const { libraryId, userId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "sender", email: "sender@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const workspaceId = await ctx.db.insert("workspaces", { kind: "personal", userId });
    const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId, name: "Teacher Education", slug: "teachers", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: createHash("sha256").update(token).digest("hex"), validationState: "valid", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    return { libraryId, userId };
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

  // Withdrawn, it's no longer one of theirs.
  await tell(4, "withdrawn", null);
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([]);
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
