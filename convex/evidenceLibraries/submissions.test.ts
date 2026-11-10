// Your submissions (OS-29, #1124): Openscholar records a paper someone sent to a community, and the community tells it
// where the paper got to (new-el #778).
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { purgeSubmissions } from "./submissions";

const modules = import.meta.glob("/convex/**/*.ts");
const token = "els_" + "b".repeat(43);

// The assistant reads each paper's page as a whole address on this site.
beforeEach(() => void vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test"));

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
  expect(await sender.query(api.evidenceLibraries.submissions.counts, {})).toEqual({ queued: 0, published: 0, returned: 1, withdrawn: 0, removed: 0, all: 1, capped: false });
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
  // Its team unpublishes the record on the community's site: removed for both, with no link to it; then back, published again.
  const statuses = async () => Promise.all(["sender", "other"].map(async (subject) => {
    const [row] = (await t.withIdentity({ subject }).query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page;
    return [row?.status, row?.recordLink];
  }));
  expect((await tell(10, "removed", null)).status).toBe(200);
  expect(await statuses()).toEqual([["removed", null], ["removed", null]]);
  await tell(11, "published", null);
  expect((await statuses()).map(([status]) => status)).toEqual(["published", "published"]);

  // Renamed, the community is found by its new name.
  await t.run((ctx) => ctx.db.patch("evidenceLibraries", libraryId, { name: "Teacher Learning" }));
  await t.mutation(internal.evidenceLibraries.submissions.refreshCommunityName, { libraryId, cursor: null });
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 }, search: "teacher learning" })).page.map((row) => row.itemKey)).toEqual(["PAPER001"]);

  // Withdrawn, it's listed as withdrawn; sent again, a late repeat of that withdrawal leaves the new submission.
  await tell(12, "withdrawn", null);
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page).toMatchObject([{ itemKey: "PAPER001", status: "withdrawn" }]);
  // Asked for, the assistant lists it as withdrawn.
  expect((await t.query(internal.evidenceLibraries.assistant.submissionsForAssistant, { userId, workspaceId, status: "withdrawn" })).page).toMatchObject([{ itemKey: "PAPER001", status: "withdrawn" }]);
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId, libraryId, requestId: "r4", papers: [{ itemKey: "PAPER001", ...paper, status: "queued" }] });
  await tell(12, "withdrawn", null);
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
  expect(row).toMatchObject({ itemKey: "EARLY001", status: "published" });
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
  // Sent again by request r11 and returned before r11 finishes here: the return stands for that send too.
  await tell("RACE0001", 3, "returned", "r11");
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId, libraryId, requestId: "r11", papers: [{ itemKey: "RACE0001", ...paper, status: "queued" }] });
  // Approved before the word that it waits was sent: published is the first word, and it's theirs.
  await tell("RACE0002", 2, "published", "r10");
  expect((await mine()).sort((a, b) => a.itemKey.localeCompare(b.itemKey))).toEqual([{ itemKey: "RACE0001", status: "returned" }, { itemKey: "RACE0002", status: "published" }]);
});

it("calls a published paper removed for whoever sent it once the team removes it, and withdrawn only for the person who took it back", async () => {
  const t = convexTest(schema, modules);
  const { libraryId, sender, owner } = await t.run(async (ctx) => {
    const sender = await ctx.db.insert("users", { clerkId: "sender", email: "sender@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const owner = await ctx.db.insert("users", { clerkId: "owner", email: "owner@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const workspaceId = await ctx.db.insert("workspaces", { kind: "personal", userId: owner });
    const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId, name: "Teacher Education", slug: "teachers", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    return { libraryId, sender, owner };
  });
  const paper = { title: "Coaching teachers", authors: "Amina Yusuf", year: 2021, openalexId: "W60", doi: "10.1000/w60" };
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId: sender, libraryId, requestId: "r1", papers: [{ itemKey: "PAPER001", ...paper, status: "published" }, { itemKey: "PAPER002", ...paper, openalexId: "W61", status: "queued" }] });
  const list = async () => (await t.withIdentity({ subject: "sender" }).query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page;
  // The owner removes the published one: the sender's list says so and no longer links its record.
  await t.mutation(internal.evidenceLibraries.submissions.forgetSent, { userId: owner, libraryId, itemKey: "PAPER001", outcome: "removed" });
  // Someone else's withdrawal touches only their own submission.
  await t.mutation(internal.evidenceLibraries.submissions.forgetSent, { userId: owner, libraryId, itemKey: "PAPER002", outcome: "withdrawn" });
  expect(Object.fromEntries((await list()).map((row) => [row.itemKey, [row.status, row.recordLink]]))).toEqual({ PAPER001: ["removed", null], PAPER002: ["queued", null] });
  await t.mutation(internal.evidenceLibraries.submissions.forgetSent, { userId: sender, libraryId, itemKey: "PAPER002", outcome: "withdrawn" });
  expect((await list()).find((row) => row.itemKey === "PAPER002")?.status).toBe("withdrawn");
});

it("emails the sender when the team answers a paper that waited for review, and not for one published as it was sent", async () => {
  const t = convexTest(schema, modules);
  const { libraryId, userId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "sender", email: "sender@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const workspaceId = await ctx.db.insert("workspaces", { kind: "personal", userId });
    const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId, name: "Teacher Education", slug: "teachers", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: createHash("sha256").update(token).digest("hex"), validationState: "valid", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    return { libraryId, userId };
  });
  const paper = { title: "Coaching teachers", authors: "Amina Yusuf", year: 2021, openalexId: "W60", doi: "10.1000/w60" };
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId, libraryId, requestId: "r1", papers: [{ itemKey: "WAITED01", ...paper, status: "queued" }, { itemKey: "DIRECT01", ...paper, openalexId: "W61", status: "published" }] });
  const tell = (itemKey: string, generation: number, status: string, note: string | null) =>
    t.mutation(internal.evidenceLibraries.submissions.applyStatus, { libraryId, credentialDigest: createHash("sha256").update(token).digest("hex"), itemKey, generation, clerkUserId: "sender", status: status as "published", note, at: 5 });
  const emails = () => t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name === "evidenceLibraries/submissionEmails:toSender").length);
  const submission = (itemKey: string) => t.run(async (ctx) => (await ctx.db.query("paperSubmissions").withIndex("by_library_and_itemKey", (q) => q.eq("libraryId", libraryId).eq("itemKey", itemKey)).unique())!._id);

  // The community repeats that a paper someone on the team published is published: nobody waited to hear it.
  await tell("DIRECT01", 2, "published", null);
  expect(await emails()).toBe(0);
  // The team declines the one that waited: its sender is told once, with the reason.
  await tell("WAITED01", 2, "returned", "Outside this community's focus");
  expect(await emails()).toBe(1);
  const submissionId = await submission("WAITED01");
  expect(await t.query(internal.evidenceLibraries.submissions.readForEmail, { submissionId, generation: 2 })).toMatchObject({ to: "sender@example.org", status: "returned", note: "Outside this community's focus", paper: { title: "Coaching teachers" }, libraryName: "Teacher Education" });
  // The team publishes it after all, before that email goes: the decline's email no longer speaks, and the sender is told it's live.
  await tell("WAITED01", 3, "published", null);
  expect(await emails()).toBe(2);
  expect(await t.query(internal.evidenceLibraries.submissions.readForEmail, { submissionId, generation: 2 })).toBeNull();
  expect(await t.query(internal.evidenceLibraries.submissions.readForEmail, { submissionId, generation: 3 })).toMatchObject({ status: "published", note: null });
  // Sent again after a decline, a paper can be declined again before Openscholar has recorded that it waits: still an answer.
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId, libraryId, requestId: "r2", papers: [{ itemKey: "RESENT01", ...paper, openalexId: "W62", status: "queued" }] });
  await tell("RESENT01", 2, "returned", "Not peer reviewed");
  await tell("RESENT01", 4, "returned", "Still not peer reviewed");
  expect(await emails()).toBe(4);
});

it("tells everyone who sent a paper when the community removes it, past the first page of senders", { tags: ["size"] }, async () => {
  const t = convexTest(schema, modules);
  const { libraryId } = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { clerkId: "owner", email: "owner@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const workspaceId = await ctx.db.insert("workspaces", { kind: "personal", userId: owner });
    const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId, name: "Teacher Education", slug: "teachers", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: createHash("sha256").update(token).digest("hex"), validationState: "valid", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    return { libraryId };
  });
  // More people sent the same paper than one page of senders holds.
  const senders = await t.run((ctx) => Promise.all(Array.from({ length: 130 }, (_, n) => ctx.db.insert("users", { clerkId: `sender${n}`, email: `s${n}@example.org`, state: "active", createdAt: 1, updatedAt: 1 }))));
  const paper = { title: "Coaching teachers", authors: "Amina Yusuf", year: 2021, openalexId: "W60", doi: "10.1000/w60" };
  for (const userId of senders) await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId, libraryId, requestId: `r-${userId}`, papers: [{ itemKey: "PAPER001", ...paper, status: "published" }] });
  vi.useFakeTimers();
  try {
    const response = await t.fetch("/api/v1/evidence-libraries/paper-submissions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contractVersion: 1, idempotencyKey: `${libraryId}:PAPER001:5`, libraryId, itemKey: "PAPER001", generation: 5, clerkUserId: "sender0", status: "removed", note: null, at: "2026-11-10T12:00:00Z" }),
    });
    expect(response.status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
  const statuses = await t.run(async (ctx) => (await ctx.db.query("paperSubmissions").withIndex("by_library_and_itemKey", (q) => q.eq("libraryId", libraryId).eq("itemKey", "PAPER001")).collect()).map((row) => row.status));
  expect(statuses).toHaveLength(130);
  expect(new Set(statuses)).toEqual(new Set(["removed"]));
});
