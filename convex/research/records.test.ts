import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { applyCommand, moveSearchAnswers, verifyMovedAnswers } from "./records";
import { restoreSearch, serializeSearch, type SavedSearch } from "../../lib/research/records";
import { convexToJson } from "convex/values";

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
  const t = convexTest({ schema, transactionLimits: true });
  const ids = await t.run(async ctx => {
    const seed = (clerkId: string) => ctx.db.insert("users", { clerkId, email: `${clerkId}@example.com`, state: "active", createdAt: 1, updatedAt: 1 });
    return { alice: await seed("alice"), bob: await seed("bob") };
  });
  return { t, ids, alice: t.withIdentity({ subject: "alice" }), bob: t.withIdentity({ subject: "bob" }) };
}

describe("account research records", () => {
  it("stores one row per paper, so changing one answer writes one row, and old revisions keep their answers", async () => {
    const { alice, t } = await setup();
    const question = "هل هذه تجربة؟ ".repeat(60);
    const large = { ...record, screeningResponses: Array.from({ length: 1500 }, (_, i) => ({ paperId: `W${i}`, responses: [{ question, response: true }, { question: "Adults?", response: i % 2 === 0 }, { question: "In Africa?", response: null }] })) };
    const current = async () => restoreSearch((await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id }))!);
    const count = (table: "screeningAnswers" | "screeningAnswerHistory" | "searchRevisions") => t.run(async ctx => (await ctx.db.query(table).collect()).length);
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: [large] });
    expect(await current()).toEqual(restoreSearch(large));
    expect(await count("screeningAnswers")).toBe(1500);
    const history = await count("screeningAnswerHistory");
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "one-answer", command: { kind: "editSearch", id: record.id, edit: { kind: "responses", paperId: "W7", responses: [{ question, response: false }], by: "person" } } });
    expect(await count("screeningAnswerHistory")).toBe(history + 1);
    expect(await count("screeningAnswers")).toBe(1500);
    expect(await count("searchRevisions")).toBe(1);
    // A full page of revisions of a large screening reads within one query's limits.
    for (let page = 2; page <= 25; page++) await alice.mutation(api.research.records.change, { accountId: "alice", requestId: `page-${page}`, command: { kind: "editSearch", id: record.id, edit: { kind: "patch", fields: { page }, clear: [] } } });
    const revisions = (await alice.query(api.research.records.revisions, { accountId: "alice", id: record.id, paginationOpts })).page.map(row => restoreSearch(row.data).screeningResponses);
    expect(revisions).toHaveLength(25);
    expect(revisions.at(-1)).toEqual(restoreSearch(large).screeningResponses);
    expect(revisions[0].W7[question]).toBe(false);
    expect((await current()).screeningResponses.W7[question]).toBe(false);
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

  it("appends user and assistant revisions, records who set each answer, and deduplicates mutation retries", async () => {
    const { t, ids, alice } = await setup();
    await alice.mutation(api.research.records.importBatch, batch);
    const args = { accountId: "alice", requestId: "screening-edit", command: { kind: "editSearch" as const, id: record.id, edit: { kind: "responses" as const, paperId: "W2", responses: [{ question: "Randomized?", response: false }], by: "person" as const } } };
    await alice.mutation(api.research.records.change, args);
    await alice.mutation(api.research.records.change, args);
    await t.run(ctx => applyCommand(ctx, ids.alice, { kind: "editSearch", id: record.id, edit: { kind: "responses", paperId: "W1", responses: [{ question: "Randomized?", response: false }] } }, "assistant"));
    await t.run(ctx => applyCommand(ctx, ids.alice, { kind: "editSearch", id: record.id, edit: { kind: "query", query: "assistant query", field: "fulltext" } }, "assistant"));
    const revisions = await alice.query(api.research.records.revisions, { accountId: "alice", id: record.id, paginationOpts });
    expect(revisions.page.map(row => [row.revision, row.author])).toEqual([[2, "assistant"], [1, "user"]]);
    expect(revisions.page[1].data).toEqual(record);
    expect(restoreSearch(revisions.page[0].data).screeningResponses).toEqual({ W1: { "Randomized?": false }, W2: { "Randomized?": false } });
    const answers = await t.run(ctx => ctx.db.query("screeningAnswers").collect());
    expect(answers.map(row => [row.paperId, row.answers[0].setBy]).sort()).toEqual([["W1", "assistant"], ["W2", "person"]]);
    expect((await t.run(ctx => ctx.db.query("screeningAnswerHistory").collect())).filter(row => row.paperId === "W2")).toHaveLength(2);
    // A person confirming the model's answer is a change, though the value is the same.
    for (const by of ["model", "person"] as const) await alice.mutation(api.research.records.change, { ...args, requestId: by, command: { ...args.command, edit: { ...args.command.edit, paperId: "W3", responses: [{ question: "Randomized?", response: true }], by } } });
    const confirmed = await t.run(ctx => ctx.db.query("screeningAnswerHistory").collect());
    expect(confirmed.filter(row => row.paperId === "W3").map(row => row.answers[0].setBy)).toEqual(["model", "person"]);
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

  it("moves answers out of chunks with every revision's answers intact, once", async () => {
    const { t, ids, alice } = await setup();
    const answers = (paperIds: string[], response: boolean | null) => paperIds.map(paperId => ({ paperId, responses: [{ question: "Randomized?", response }] }));
    // Saved the way the chunk storage did: answers in chunks on the search and each revision.
    const [live, gone] = await t.run(async ctx => {
      const chunk = (responses: SavedSearch["screeningResponses"]) => ctx.db.insert("researchResponseChunks", { responses });
      const seed = async (localId: string, snapshots: SavedSearch["screeningResponses"][], deleted: boolean) => {
        const data = { ...record, id: localId, screeningResponses: [] };
        const searchId = await ctx.db.insert("searches", { userId: ids.alice, localId, revision: snapshots.length, data, responseChunks: [await chunk(snapshots.at(-1)!)] });
        for (const [i, responses] of snapshots.entries()) await ctx.db.insert("searchRevisions", { userId: ids.alice, searchId, revision: i + 1, author: "user", data, deleted: false, createdAt: i + 1, responseChunks: [await chunk(responses)] });
        if (deleted) await ctx.db.delete("searches", searchId);
        return searchId;
      };
      return [await seed("live", [answers(["W1", "W2"], true), answers(["W2", "W3"], false), []], false), await seed("gone", [answers(["W9"], null)], true)];
    });
    const read = async () => ({
      search: await alice.query(api.research.records.getSearch, { accountId: "alice", id: "live" }),
      revisions: (await alice.query(api.research.records.revisions, { accountId: "alice", id: "live", paginationOpts })).page,
    });
    const before = await read();
    expect(await t.run(ctx => verifyMovedAnswers(ctx))).toMatchObject({ waiting: 4 });
    for (const searchId of [live, live, gone]) await t.run(ctx => moveSearchAnswers(ctx, searchId, ids.alice));
    expect(await read()).toEqual(before);
    expect(await t.run(ctx => verifyMovedAnswers(ctx))).toEqual({ revisions: 4, waiting: 0, mismatches: [] });
    expect((await t.run(ctx => ctx.db.get("searches", live)))?.responseChunks).toBeUndefined();
    const history = await t.run(ctx => ctx.db.query("screeningAnswerHistory").collect());
    expect(history.every(row => row.answers.every(answer => answer.setBy === "unrecorded"))).toBe(true);
    expect(history).toHaveLength(2 + 3 + 2 + 1); // per revision: two set; one removed, one changed, one set; two removed; the deleted search's one
  });

  it("moves a search still on chunks when it is edited, so its old revisions keep their answers", async () => {
    const { t, ids, alice } = await setup();
    await t.run(async ctx => {
      const responses = [{ paperId: "W1", responses: [{ question: "Randomized?", response: true }] }];
      const data = { ...record, screeningResponses: [] };
      const searchId = await ctx.db.insert("searches", { userId: ids.alice, localId: record.id, revision: 1, data, responseChunks: [await ctx.db.insert("researchResponseChunks", { responses })] });
      await ctx.db.insert("searchRevisions", { userId: ids.alice, searchId, revision: 1, author: "user", data, deleted: false, createdAt: 1, responseChunks: [await ctx.db.insert("researchResponseChunks", { responses })] });
    });
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "flip", command: { kind: "editSearch", id: record.id, edit: { kind: "replaceScreeningQuestion", question: "Randomized?", replacement: null } } });
    const [latest, first] = (await alice.query(api.research.records.revisions, { accountId: "alice", id: record.id, paginationOpts })).page;
    expect(restoreSearch(first.data).screeningResponses).toEqual({ W1: { "Randomized?": true } });
    expect(latest.data.screeningResponses).toEqual([]);
    expect(await t.run(ctx => verifyMovedAnswers(ctx))).toEqual({ revisions: 1, waiting: 0, mismatches: [] });
  });
});
