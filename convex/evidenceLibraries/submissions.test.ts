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
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId, libraryId, papers: [{ itemKey: "PAPER001", ...paper, status: "queued" }] });

  const tell = async (generation: number, status: string, note: string | null, credential = token) => {
    const response = await t.fetch("/api/v1/evidence-libraries/paper-submissions", {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contractVersion: 1, idempotencyKey: `${libraryId}:PAPER001:${generation}`, libraryId, itemKey: "PAPER001", generation, clerkUserId: "sender", status, note, at: "2026-11-08T12:00:00Z" }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  expect((await tell(2, "returned", "Outside this community's focus")).body).toEqual({ idempotencyKey: `${libraryId}:PAPER001:2`, generation: 2 });
  // An earlier change that arrives late changes nothing; a repeat of the last one is answered the same.
  await tell(1, "published", null);
  expect((await tell(2, "returned", "Outside this community's focus")).status).toBe(200);
  expect((await tell(3, "published", null, "els_" + "c".repeat(43))).status).toBe(401);

  const sender = t.withIdentity({ subject: "sender" });
  const mine = await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } });
  expect(mine.page).toMatchObject([{ itemKey: "PAPER001", ...paper, status: "returned", note: "Outside this community's focus", community: { libraryId, name: "Teacher Education" } }]);
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 }, status: "queued" })).page).toEqual([]);
  // Searched by its title or its community's name, and counted by status for the filter.
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 }, search: "teacher education" })).page.map((row) => row.itemKey)).toEqual(["PAPER001"]);
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 }, search: "astronomy" })).page).toEqual([]);
  expect(await sender.query(api.evidenceLibraries.submissions.counts, {})).toEqual({ queued: 0, published: 0, returned: 1, all: 1 });

  // Sent again, it waits for review again, and the community's next word applies.
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId, libraryId, papers: [{ itemKey: "PAPER001", ...paper, status: "queued" }] });
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page[0]).toMatchObject({ status: "queued", note: null });
  await tell(3, "published", null);
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page[0]).toMatchObject({ status: "published" });
  // Withdrawn, it's no longer one of theirs.
  await tell(4, "withdrawn", null);
  expect((await sender.query(api.evidenceLibraries.submissions.mine, { paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([]);
});
