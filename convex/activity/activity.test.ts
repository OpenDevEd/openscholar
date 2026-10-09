// An item's Activity (#656): the user action wrappers write what each change did and who made it.
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { ensureWorkspace } from "../workspaces/create";
import { bookkeepLater } from "../screening/bookkeeping";
import { setupScreeningWorkpool } from "../screening/workpool.test-support";
import { searchNote } from "../research/records";
import type { SavedSearch, SearchEdit } from "../../lib/research/records";

/** Alice and Bob in a lab, and Carol, who isn't. */
async function lab() {
  const t = convexTest(schema);
  const seeded = await t.run(async (ctx) => {
    const users: Record<string, Id<"users">> = {};
    for (const clerkId of ["alice", "bob", "carol"]) users[clerkId] = await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, firstName: clerkId[0].toUpperCase() + clerkId.slice(1), state: "active", createdAt: 1, updatedAt: 1 });
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Learning Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    for (const clerkUserId of ["alice", "bob"]) await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `orgmem_${clerkUserId}`, clerkUserId, role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    return { users, workspaceId: await ensureWorkspace(ctx, { kind: "organization", organizationId }), carolOwn: await ensureWorkspace(ctx, { kind: "personal", userId: users.carol }) };
  });
  const [alice, bob, carol] = ["alice", "bob", "carol"].map((subject) => t.withIdentity({ subject }));
  return { t, alice, bob, carol, ...seeded };
}

it("lists what changed on a collection, newest first, by whom, and what the assistant did for someone", async () => {
  const { alice, bob, workspaceId } = await lab();
  const { id: collectionId } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Trials" });
  await alice.mutation(api.library.collections.renameCollection, { workspaceId, collectionId, name: "RCTs" });
  // A rename to the name it has changes nothing, and notes nothing.
  await alice.mutation(api.library.collections.renameCollection, { workspaceId, collectionId, name: "RCTs" });
  await bob.mutation(api.library.mutations.saveToLibrary, { workspaceId, openalexId: "https://openalex.org/W1", title: "Coaching at scale", collectionId });
  const listed = async (as: typeof alice) => (await as.query(api.activity.queries.list, { workspaceId, kind: "collection", id: collectionId, paginationOpts: { cursor: null, numItems: 10 } })).page;

  expect((await listed(alice)).map(({ by, happened, count, detail, viaAssistant }) => ({ by: by.name, you: by.you, happened, count, detail, viaAssistant }))).toEqual([
    { by: "Bob", you: false, happened: "added", count: 1, detail: "Coaching at scale", viaAssistant: undefined },
    { by: "Alice", you: true, happened: "renamed", count: undefined, detail: "Trials", viaAssistant: undefined },
    { by: "Alice", you: true, happened: "created", count: undefined, detail: "Trials", viaAssistant: undefined },
  ]);
});

it("notes a paper leaving a collection with the library, and coming back with Undo", async () => {
  const { alice, bob, workspaceId } = await lab();
  const { id: collectionId } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Trials" });
  await bob.mutation(api.library.mutations.saveToLibrary, { workspaceId, openalexId: "https://openalex.org/W1", title: "Coaching at scale", collectionId });
  const { undo } = await bob.mutation(api.library.mutations.removeFromLibrary, { workspaceId, openalexId: "https://openalex.org/W1" });
  await bob.mutation(api.library.mutations.restoreLibraryItem, { workspaceId, ...undo!.args });
  const rows = (await alice.query(api.activity.queries.list, { workspaceId, kind: "collection", id: collectionId, paginationOpts: { cursor: null, numItems: 10 } })).page;
  expect(rows.slice(0, 2).map(({ by, happened, count, detail }) => ({ by: by.name, happened, count, detail }))).toEqual([
    { by: "Bob", happened: "added", count: 1, detail: "Coaching at scale" },
    { by: "Bob", happened: "removed", count: 1, detail: "Coaching at scale" },
  ]);
});

it("notes what a screening did once it ends: the papers it answered, on it and on what it read, and those it saved", async () => {
  vi.useFakeTimers();
  try {
    const { t, alice, users, workspaceId } = await lab();
    setupScreeningWorkpool(t);
    const { id: read } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Trials" });
    const { id: saveTo } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Included" });
    const questions = [{ key: "q1", question: "Is it a trial?" }];
    const scoringConfig = { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], starThresholds: [{ minScore: 0, stars: 1 }], minimumScore: 1 };
    // A job whose two papers were read and answered, one included.
    const jobId = await t.run(async (ctx) => {
      const screeningId = await ctx.db.insert("screenings", { workspaceId, version: 0, createdAt: 1 });
      const jobId = await ctx.db.insert("screeningJobs", { workspaceId, createdBy: users.alice, status: "processing", totalPapers: 2, questions, scoringConfig, screeningId, set: { kind: "collection", collectionId: read }, targetCollectionId: saveTo, name: "First pass", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("screeningJobProgress", { jobId, completed: 0, skipped: 0, failed: 0, qualified: 0 });
      for (const [i, qualified] of [[1, true], [2, false]] as const) {
        await ctx.db.insert("screeningResults", { jobId, openalexId: `https://openalex.org/W${i}`, title: `Paper ${i}`, status: "completed", createdAt: 1, completedAt: 2, qualified, score: qualified ? 1 : 0, stars: 1, answers: { q1: qualified }, confidences: { q1: 0.9 }, pendingAnswers: true, doneAt: ctx.db.vars.commitTs });
      }
      await bookkeepLater(ctx);
      return jobId;
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const listed = async (kind: "screening" | "collection", id: string) =>
      (await alice.query(api.activity.queries.list, { workspaceId, kind, id, paginationOpts: { cursor: null, numItems: 10 } })).page.map(({ by, happened, count, detail }) => ({ by: by.name, happened, count, detail }));
    expect(await listed("screening", jobId)).toEqual([{ by: "Alice", happened: "screened", count: 2, detail: undefined }]);
    expect((await listed("collection", read))[0]).toEqual({ by: "Alice", happened: "screened", count: 2, detail: "First pass" });
    expect((await listed("collection", saveTo))[0]).toEqual({ by: "Alice", happened: "added", count: 1, detail: "First pass" });
  } finally {
    vi.useRealTimers();
  }
});

it("says when the assistant made a change, as the person who asked", async () => {
  const { t, alice, users, workspaceId } = await lab();
  const { id } = await t.mutation(internal.library.collections.createCollectionForAssistant, { userId: users.alice, workspaceId, name: "From the chat" });
  const [row] = (await alice.query(api.activity.queries.list, { workspaceId, kind: "collection", id, paginationOpts: { cursor: null, numItems: 10 } })).page;
  expect(row).toMatchObject({ by: { name: "Alice", you: true }, happened: "created", viaAssistant: true });
});

it("shows an item's activity only in the workspace that has it", async () => {
  const { alice, carol, workspaceId, carolOwn } = await lab();
  const { id } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Trials" });
  expect((await carol.query(api.activity.queries.list, { workspaceId: carolOwn, kind: "collection", id, paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([]);
  expect(await carol.query(api.activity.queries.startedBy, { workspaceId: carolOwn, kind: "collection", id })).toBeNull();
  await expect(carol.query(api.activity.queries.list, { workspaceId, kind: "collection", id, paginationOpts: { cursor: null, numItems: 10 } })).rejects.toThrow();
});

it("names who started an item in an organization, and no one in your own workspace", async () => {
  const { alice, bob, carol, workspaceId, carolOwn } = await lab();
  const { id } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Trials" });
  expect(await bob.query(api.activity.queries.startedBy, { workspaceId, kind: "collection", id })).toMatchObject({ name: "Alice", you: false });
  expect(await alice.query(api.activity.queries.startedBy, { workspaceId, kind: "collection", id })).toMatchObject({ name: "Alice", you: true });
  const { id: own } = await carol.mutation(api.library.collections.createCollection, { workspaceId: carolOwn, name: "Mine" });
  expect(await carol.query(api.activity.queries.startedBy, { workspaceId: carolOwn, kind: "collection", id: own })).toBeNull();
});

it("notes a search's own edits, not the count and page its page keeps current", () => {
  const edit = (edit: SearchEdit) => searchNote({ kind: "editSearch", id: "s1", edit });
  expect(edit({ kind: "patch", fields: { count: 26_362 }, clear: [] })).toBeNull();
  expect(edit({ kind: "patch", fields: { page: 2 }, clear: [] })).toBeNull();
  expect(edit({ kind: "patch", fields: { count: 10, openAccessOnly: true }, clear: [] })).toMatchObject({ kind: "search", id: "s1", happened: "edited" });
  expect(edit({ kind: "query", query: "coaching AND rct", field: "title_and_abstract" })).toMatchObject({ happened: "edited", detail: "coaching AND rct" });
  // The model's answers aren't anyone's change; a person's are.
  expect(edit({ kind: "responses", paperId: "W1", by: "model", responses: [] })).toBeNull();
  expect(edit({ kind: "responses", paperId: "W1", by: "person", responses: [] })).toMatchObject({ happened: "answered", count: 1 });
});

it("keeps each workspace's activity to itself, even for searches sharing an ID", async () => {
  const { alice, carol, workspaceId, carolOwn } = await lab();
  const search = (id: string, query: string) => ({ kind: "createSearch" as const, search: { ...SEARCH, id, query } });
  // A search's ID is the browser's, unique only within a workspace: Carol makes one with the lab's.
  await alice.mutation(api.research.records.change, { accountId: "alice", workspaceId, requestId: "lab", command: search("same", "lab query") });
  await carol.mutation(api.research.records.change, { accountId: "carol", workspaceId: carolOwn, requestId: "own", command: search("same", "her query") });
  const listed = async (as: typeof alice, where: Id<"workspaces">) => (await as.query(api.activity.queries.list, { workspaceId: where, kind: "search", id: "same", paginationOpts: { cursor: null, numItems: 10 } })).page.map((row) => row.detail);
  expect(await listed(carol, carolOwn)).toEqual(["her query"]);
  expect(await listed(alice, workspaceId)).toEqual(["lab query"]);
});

const SEARCH: SavedSearch = {
  id: "s", query: "q", field: "title_and_abstract", count: 0,
  queryHistoryCount: 0, questionCount: 0, latestQuestion: "", questionText: "",
  screeningQuestions: [], screeningResponses: [],
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  dateRange: { from: "2020-01-01T00:00:00Z", to: "2025-12-31T00:00:00Z" }, yearRange: [2020, 2025], filterType: "year", isYearRangeEnabled: false,
  sortBy: "relevance_score:desc", selectedRegions: [], selectedCountryFocus: [], ratingRange: [0, 5], onlyRatedPapers: false,
  citesItemId: "", citedByItemId: "", relatedToItemId: "", reviewFilter: false, researchAreas: [], sdgs: [],
  openAccessOnly: false, workTypes: [], workLanguages: [], institutionTypes: [], funders: [], authors: [],
  minCitations: 0, hasAbstract: false, includeRetracted: false, language: "en", page: 1,
};

it("notes a search change once, and not one that left the search as it was", async () => {
  const { alice, workspaceId } = await lab();
  const change = (requestId: string, command: Parameters<typeof searchNote>[0]) => alice.mutation(api.research.records.change, { accountId: "alice", workspaceId, requestId, command });
  const created = { kind: "createSearch" as const, search: { ...SEARCH, id: "s1", query: "tutoring" } };
  await change("make", created);
  // A retried request applies once.
  await change("make", created);
  // Making it again, keeping the one there, changes nothing.
  await change("again", { ...created, ifExists: "keep" });
  await change("query", { kind: "editSearch", id: "s1", edit: { kind: "query", query: "tutoring AND rct", field: "title_and_abstract" } });
  await change("same", { kind: "editSearch", id: "s1", edit: { kind: "query", query: "tutoring AND rct", field: "title_and_abstract" } });
  const rows = (await alice.query(api.activity.queries.list, { workspaceId, kind: "search", id: "s1", paginationOpts: { cursor: null, numItems: 10 } })).page;
  expect(rows.map((row) => [row.happened, row.detail])).toEqual([["edited", "tutoring AND rct"], ["created", "tutoring"]]);
});
