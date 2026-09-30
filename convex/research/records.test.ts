import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { applyCommand } from "./records";
import { restoreSearch, serializeSearch, type SavedSearch } from "../../lib/research/records";
import { convexToJson } from "convex/values";
import { asSchema } from "ai";
import type { ActionCtx } from "../_generated/server";
import { assistantTools } from "../lib/assistantTools";
import { USER_ACTIONS } from "../lib/userActionRegistry";

const record: SavedSearch = {
  id: "local-original", query: "tutoring AND randomized", field: "title_and_abstract", count: 42,
  queryHistory: [{ query: "tutoring", field: "title", timestamp: "2026-08-01T12:00:00Z" }],
  questionHistory: [{ question: "Does tutoring work?", timestamp: "2026-08-01T11:00:00Z" }],
  screeningQuestions: [{ question: "Randomized?" }], screeningResponses: [{ paperId: "W1", responses: [{ question: "Randomized?", response: true }] }, { paperId: "W2", responses: [{ question: "Randomized?", response: null }] }],
  createdAt: "2026-08-01T11:00:00Z", updatedAt: "2026-09-01T12:00:00Z",
  dateRange: { from: "2020-01-01T00:00:00Z", to: "2025-12-31T00:00:00Z" }, yearRange: [2020, 2025], filterType: "date", isYearRangeEnabled: true,
  sortBy: "cited_by_count:desc", selectedRegions: ["africa"], selectedCountryFocus: ["MA"], ratingRange: [2, 5], onlyRatedPapers: true,
  citesItemId: "W10", citedByItemId: "W11", relatedToItemId: "W12", reviewFilter: true, researchAreas: ["17"], sdgs: ["4"],
  openAccessOnly: true, workTypes: ["article"], workLanguages: ["en"], institutionTypes: ["education"], funders: ["F123"],
  minCitations: 3, hasAbstract: true, includeRetracted: false, language: "fr", page: 3, chatJobIdsByAccountId: { alice: "prior-chat" },
};
const batch = { accountId: "alice", searches: [record], shortcuts: [{ shorthand: "rct", expansion: "randomized controlled trial", createdAt: 1700000000000 }], ratings: [{ paperId: "https://openalex.org/W1", rating: 4 }] };
const paginationOpts = { cursor: null, numItems: 25 };

async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async ctx => {
    const seed = (clerkId: string) => ctx.db.insert("users", { clerkId, email: `${clerkId}@example.com`, state: "active", createdAt: 1, updatedAt: 1 });
    return { alice: await seed("alice"), bob: await seed("bob") };
  });
  return { t, ids, alice: t.withIdentity({ subject: "alice" }), bob: t.withIdentity({ subject: "bob" }) };
}

describe("account research records", () => {
  it("keeps large screening runs in bounded immutable chunks and restores old revisions", async () => {
    const { alice, t } = await setup();
    const question = "هل هذه تجربة؟ ".repeat(60);
    const large = { ...record, screeningResponses: Array.from({ length: 1500 }, (_, i) => ({ paperId: `W${i}`, responses: [{ question, response: true }] })) };
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: [large] });
    expect(await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id })).toEqual(large);
    const chunks = await t.run(ctx => ctx.db.query("researchResponseChunks").collect());
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => JSON.stringify(chunk).length < 250_000)).toBe(true);
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "large-page", command: { kind: "editSearch", id: record.id, edit: { kind: "patch", fields: { page: 2 }, clear: [] } } });
    expect(await t.run(ctx => ctx.db.query("researchResponseChunks").collect())).toHaveLength(chunks.length);
    expect((await alice.query(api.research.records.revisions, { accountId: "alice", id: record.id, paginationOpts })).page[1].data).toEqual(large);
  });

  it("orders imported history by its original creation date", async () => {
    const { alice } = await setup();
    const rows = [3, 1, 2].map(day => ({ ...record, id: `day-${day}`, createdAt: `2026-09-0${day}T00:00:00.000Z` }));
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: rows });
    expect((await alice.query(api.research.records.searches, { accountId: "alice", paginationOpts })).page.map(row => row.id)).toEqual(["day-3", "day-2", "day-1"]);
  });
  it("preserves Unicode, dollar-prefixed, and long screening questions through Convex serialization", async () => {
    const { alice } = await setup();
    const question = "$ هل كانت الدراسة عشوائية؟ " + "long question ".repeat(100);
    const original = { ...restoreSearch(record), screeningQuestions: [{ question }], screeningResponses: { W1: { [question]: true } } };
    const search = serializeSearch(original);
    const args = { ...batch, searches: [search] };
    expect(convexToJson(args)).toMatchObject({ searches: [{ screeningQuestions: [{ question }] }] });
    await alice.mutation(api.research.records.importBatch, args);
    const stored = await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id });
    expect(restoreSearch(stored!).screeningResponses).toEqual(original.screeningResponses);
  });
  it("imports every saved field once, and preserves subsequent cloud edits on retry", async () => {
    const { alice, t } = await setup();
    await alice.mutation(api.research.records.importBatch, batch);
    await alice.mutation(api.research.records.importBatch, batch);
    expect(await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id })).toEqual(record);
    expect((await alice.query(api.research.records.shortcuts, { accountId: "alice", paginationOpts })).page).toEqual(batch.shortcuts);
    expect((await alice.query(api.research.records.ratings, { accountId: "alice", paginationOpts })).page).toEqual(batch.ratings);
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "edit-query", command: { kind: "editSearch", id: record.id, edit: { kind: "query", query: "updated", field: "abstract" } } });
    await alice.mutation(api.research.records.importBatch, batch);
    const after = await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id });
    expect(after?.query).toBe("updated");
    expect(after?.screeningResponses).toEqual(record.screeningResponses);
    expect(after?.queryHistory).toHaveLength(2);
    expect(Date.parse(after!.queryHistory[1].timestamp)).toBeGreaterThan(Date.parse(record.updatedAt));
    expect(await t.run(ctx => ctx.db.query("searches").collect())).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("searchRevisions").collect())).toHaveLength(2);
  });

  it("denies anonymous and cross-account access, including an account switch during import", async () => {
    const { t, alice, bob } = await setup();
    await alice.mutation(api.research.records.importBatch, batch);
    await expect(t.query(api.research.records.getSearch, { accountId: "alice", id: record.id })).rejects.toThrow();
    await expect(bob.mutation(api.research.records.importBatch, batch)).rejects.toThrow("Account changed");
    expect(await bob.query(api.research.records.getSearch, { accountId: "bob", id: record.id })).toBeNull();
    for (const query of [api.research.records.searches, api.research.records.shortcuts, api.research.records.ratings]) {
      expect((await bob.query(query, { accountId: "bob", paginationOpts })).page).toEqual([]);
    }
    await expect(bob.mutation(api.research.records.change, { accountId: "bob", requestId: "steal", command: { kind: "editSearch", id: record.id, edit: { kind: "query", query: "stolen", field: "title" } } })).rejects.toThrow("Search not found");
    expect((await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id }))?.query).toBe(record.query);
  });

  it("appends user and assistant revisions and deduplicates mutation retries", async () => {
    const { t, ids, alice } = await setup();
    await alice.mutation(api.research.records.importBatch, batch);
    const args = { accountId: "alice", requestId: "screening-edit", command: { kind: "editSearch" as const, id: record.id, edit: { kind: "responses" as const, paperId: "W2", responses: [{ question: "Randomized?", response: false }] } } };
    await alice.mutation(api.research.records.change, args);
    await alice.mutation(api.research.records.change, args);
    await t.run(ctx => applyCommand(ctx, ids.alice, { kind: "editSearch", id: record.id, edit: { kind: "query", query: "assistant query", field: "fulltext" } }, "assistant"));
    const revisions = await alice.query(api.research.records.revisions, { accountId: "alice", id: record.id, paginationOpts });
    expect(revisions.page.map(row => [row.revision, row.author])).toEqual([[3, "assistant"], [2, "user"], [1, "user"]]);
    expect(revisions.page[2].data).toEqual(record);
    expect(restoreSearch(revisions.page[1].data).screeningResponses.W2["Randomized?"]).toBe(false);
  });

  it("merges independent paper answers and removes only a renamed question's answers", async () => {
    const { alice } = await setup();
    await alice.mutation(api.research.records.importBatch, batch);
    for (const paperId of ["W1", "W2"]) await alice.mutation(api.research.records.change, { accountId: "alice", requestId: paperId, command: { kind: "editSearch", id: record.id, edit: { kind: "responses", paperId, responses: [{ question: "Adults?", response: true }] } } });
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "rename", command: { kind: "editSearch", id: record.id, edit: { kind: "replaceScreeningQuestion", question: "Randomized?", replacement: "Trial?" } } });
    expect(restoreSearch((await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id }))!).screeningResponses).toEqual({ W1: { "Adults?": true }, W2: { "Adults?": true } });
  });

  it("keeps deletion final when an old local import is retried", async () => {
    const { alice } = await setup();
    await alice.mutation(api.research.records.importBatch, batch);
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "delete", command: { kind: "deleteSearch", id: record.id } });
    await alice.mutation(api.research.records.importBatch, batch);
    expect(await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id })).toBeNull();
  });

  it("preserves a changed local search as one separate copy and rolls back invalid batches", async () => {
    const { alice, t } = await setup();
    await expect(alice.mutation(api.research.records.importBatch, { ...batch, ratings: [{ paperId: "W1", rating: 6 }] })).rejects.toThrow();
    expect(await t.run(ctx => ctx.db.query("searches").collect())).toEqual([]);
    await alice.mutation(api.research.records.importBatch, batch);
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: [{ ...record, query: "local changed" }] });
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: [{ ...record, query: "local changed" }] });
    expect((await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id }))?.query).toBe(record.query);
    const rows = await t.run(ctx => ctx.db.query("searches").collect());
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.data.query).sort()).toEqual(["local changed", record.query]);
  });

  it("paginates beyond the first batch without losing records", async () => {
    const { alice } = await setup();
    for (let start = 0; start < 30; start += 10) await alice.mutation(api.research.records.importBatch, { accountId: "alice", searches: Array.from({ length: 10 }, (_, i) => ({ ...record, id: `local-${start + i}` })), shortcuts: [], ratings: [] });
    const first = await alice.query(api.research.records.searches, { accountId: "alice", paginationOpts });
    const second = await alice.query(api.research.records.searches, { accountId: "alice", paginationOpts: { numItems: 25, cursor: first.continueCursor } });
    expect(first.isDone).toBe(false);
    expect(second.isDone).toBe(true);
    expect(new Set([...first.page, ...second.page].map(row => row.id)).size).toBe(30);
  });
});

describe("research actions as assistant tools", () => {
  // The tools run inside an agent's action; this context passes their calls to the test backend.
  const actionCtx = (t: ReturnType<typeof convexTest>) =>
    ({ runQuery: t.query, runMutation: t.mutation }) as unknown as ActionCtx;
  const call = { messages: [], context: undefined };

  it("act as the sender, record the assistant as author, and apply a retried call once", async () => {
    const { t, ids, alice } = await setup();
    const tools = assistantTools(actionCtx(t), ids.alice, USER_ACTIONS);
    const create = { command: { kind: "createSearch" as const, search: record } };
    await tools.research_records_change.execute!(create, { ...call, toolCallId: "call-1" });
    await tools.research_records_change.execute!(create, { ...call, toolCallId: "call-1" });
    expect(await t.run(ctx => ctx.db.query("searches").collect())).toHaveLength(1);
    const history = await alice.query(api.research.records.revisions, { accountId: "alice", id: record.id, paginationOpts });
    expect(history.page.map(row => row.author)).toEqual(["assistant"]);
    expect(await tools.research_records_getSearch.execute!({ id: record.id }, { ...call, toolCallId: "call-2" })).toEqual(record);
  });

  it("never reach another account's records", async () => {
    const { t, ids, alice } = await setup();
    await alice.mutation(api.research.records.importBatch, batch);
    const bobTools = assistantTools(actionCtx(t), ids.bob, USER_ACTIONS);
    expect(await bobTools.research_records_getSearch.execute!({ id: record.id }, { ...call, toolCallId: "call-3" })).toBeNull();
    await bobTools.research_records_change.execute!({ command: { kind: "deleteSearch", id: record.id } }, { ...call, toolCallId: "call-4" });
    expect(await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id })).toEqual(record);
  });

  it("offer every registered action to the model, with the retry key left to the tool", async () => {
    const { t, ids } = await setup();
    const tools = assistantTools(actionCtx(t), ids.alice, USER_ACTIONS);
    expect(Object.keys(tools)).toHaveLength(USER_ACTIONS.length);
    for (const entry of USER_ACTIONS) {
      const schema = await asSchema(tools[entry.path.replace(/[/:]/g, "_")]!.inputSchema).jsonSchema;
      expect(Object.keys((schema as { properties?: object }).properties ?? {})).toEqual(Object.keys(entry.args).filter(name => name !== (entry.kind === "mutation" ? entry.retryKey : undefined)));
    }
  });
});
