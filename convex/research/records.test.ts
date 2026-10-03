import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { applyCommand, moveSearchAnswers, verifyMovedAnswers } from "./records";
import { restoreSearch, serializeSearch, type SavedSearch } from "../../lib/research/records";
import { convexToJson } from "convex/values";
import { asSchema } from "ai";
import type { ActionCtx } from "../_generated/server";
import { assistantTools } from "../lib/assistantTools";
import { USER_ACTIONS } from "../lib/userActionRegistry";

const record: SavedSearch = {
  id: "local-original", query: "tutoring AND randomized", field: "title_and_abstract", count: 42,
  queryHistoryCount: 1, questionCount: 1, latestQuestion: "Does tutoring work?", questionText: "Does tutoring work?",
  screeningQuestions: [{ question: "Randomized?" }], screeningResponses: [{ paperId: "W1", responses: [{ question: "Randomized?", response: true }] }, { paperId: "W2", responses: [{ question: "Randomized?", response: null }] }],
  createdAt: "2026-08-01T11:00:00Z", updatedAt: "2026-09-01T12:00:00Z",
  dateRange: { from: "2020-01-01T00:00:00Z", to: "2025-12-31T00:00:00Z" }, yearRange: [2020, 2025], filterType: "date", isYearRangeEnabled: true,
  sortBy: "cited_by_count:desc", selectedRegions: ["africa"], selectedCountryFocus: ["MA"], ratingRange: [2, 5], onlyRatedPapers: true,
  citesItemId: "W10", citedByItemId: "W11", relatedToItemId: "W12", reviewFilter: true, researchAreas: ["17"], sdgs: ["4"],
  openAccessOnly: true, workTypes: ["article"], workLanguages: ["en"], institutionTypes: ["education"], funders: ["F123"],
  minCitations: 3, hasAbstract: true, includeRetracted: false, language: "fr", page: 3, chatJobIdsByAccountId: { alice: "prior-chat" },
};
const history = {
  queryHistory: [{ query: "tutoring", field: "title" as const, timestamp: "2026-08-01T12:00:00Z" }],
  questionHistory: [{ question: "Does tutoring work?", timestamp: "2026-08-01T11:00:00Z" }],
};
/** A search as this browser imports it, with the history it kept. */
const imported = (search: SavedSearch) => ({ search, history });
const batch = { accountId: "alice", searches: [imported(record)], shortcuts: [{ shorthand: "rct", expansion: "randomized controlled trial", createdAt: 1700000000000 }], ratings: [{ paperId: "https://openalex.org/W1", rating: 4 }] };
const paginationOpts = { cursor: null, numItems: 25 };

async function setup() {
  const t = convexTest({ schema, transactionLimits: true });
  const ids = await t.run(async ctx => {
    const seed = (clerkId: string) => ctx.db.insert("users", {libraryItemCount: 0,  clerkId, email: `${clerkId}@example.com`, state: "active", createdAt: 1, updatedAt: 1 });
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
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: [imported(large)] });
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
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: rows.map(imported) });
    expect((await alice.query(api.research.records.listedSearches, { accountId: "alice", sort: "recent", paginationOpts })).page.map(row => row.id)).toEqual(["day-3", "day-2", "day-1"]);
  });
  it("preserves Unicode, dollar-prefixed, and long screening questions through Convex serialization", async () => {
    const { alice } = await setup();
    const question = "$ هل كانت الدراسة عشوائية؟ " + "long question ".repeat(100);
    const original = { ...restoreSearch(record), screeningQuestions: [{ question }], screeningResponses: { W1: { [question]: true } } };
    const search = serializeSearch(original);
    const args = { ...batch, searches: [imported(search)] };
    expect(convexToJson(args)).toMatchObject({ searches: [{ search: { screeningQuestions: [{ question }] } }] });
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
    expect(after?.queryHistoryCount).toBe(2);
    const queries = (await alice.query(api.research.records.searchHistory, { accountId: "alice", id: record.id, kind: "query", paginationOpts })).page;
    expect(queries.map(entry => entry.text)).toEqual(["updated", "tutoring"]);
    expect(Date.parse(queries[0].timestamp)).toBeGreaterThan(Date.parse(record.updatedAt));
    expect(await t.run(ctx => ctx.db.query("searches").collect())).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("searchRevisions").collect())).toHaveLength(2);
  });

  it("keeps each search's history in rows that its counts match, newest first a page at a time", async () => {
    const { alice } = await setup();
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: [imported(record), imported({ ...record, id: "other" })] });
    const edit = (id: string, requestId: string, edit: unknown) => alice.mutation(api.research.records.change, { accountId: "alice", requestId, command: { kind: "editSearch", id, edit } as never });
    const entries = async (id: string, kind: "query" | "question", numItems = 25) => (await alice.query(api.research.records.searchHistory, { accountId: "alice", id, kind, paginationOpts: { cursor: null, numItems } })).page.map(entry => entry.text);
    for (const query of ["second", "third"]) await edit(record.id, query, { kind: "query", query, field: "title" });
    await edit(record.id, "question", { kind: "question", question: "For whom?" });
    expect(await entries(record.id, "query")).toEqual(["third", "second", "tutoring"]);
    expect(await entries(record.id, "question")).toEqual(["For whom?", "Does tutoring work?"]);
    const first = await alice.query(api.research.records.searchHistory, { accountId: "alice", id: record.id, kind: "query", paginationOpts: { cursor: null, numItems: 2 } });
    const rest = await alice.query(api.research.records.searchHistory, { accountId: "alice", id: record.id, kind: "query", paginationOpts: { cursor: first.continueCursor, numItems: 2 } });
    expect([...first.page, ...rest.page].map(entry => entry.text)).toEqual(["third", "second", "tutoring"]);
    const entryAt = async (stepsBack: number) => alice.query(api.research.records.searchHistoryEntry, { accountId: "alice", id: record.id, kind: "query", stepsBack });
    expect([await entryAt(0), await entryAt(2), await entryAt(3)]).toEqual([{ entry: expect.objectContaining({ text: "third" }) }, { entry: expect.objectContaining({ text: "tutoring" }) }, { entry: null }]);
    await edit(record.id, "remove", { kind: "removeQueryHistoryEntry", ...history.queryHistory[0] });
    await expect(edit(record.id, "remove-again", { kind: "removeQueryHistoryEntry", ...history.queryHistory[0] })).rejects.toThrow("History entry not found.");
    expect(await entries(record.id, "query")).toEqual(["third", "second"]);
    expect(await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id })).toMatchObject({ queryHistoryCount: 2, questionCount: 2, latestQuestion: "For whom?", questionText: "Does tutoring work?\nFor whom?" });
    // A copy gives the other search this one's parameters and history at once, and the real counts.
    const source = (await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id }))!;
    const copy = (id: string, requestId: string) => edit(id, requestId, { kind: "copySearch", from: record.id, fromUpdatedAt: source.updatedAt, fields: { query: "copied" }, clear: [], summary: { queryHistoryCount: 99, questionCount: 0, questionText: "" } });
    await copy("other", "copy");
    expect(await entries("other", "query")).toEqual(["third", "second"]);
    expect(await entries("other", "question")).toEqual(["For whom?", "Does tutoring work?"]);
    expect(await alice.query(api.research.records.getSearch, { accountId: "alice", id: "other" })).toMatchObject({ query: "copied", queryHistoryCount: 2, questionCount: 2, latestQuestion: "For whom?" });
    // A search given its own history keeps it.
    await copy(record.id, "copy-to-itself");
    expect(await entries(record.id, "query")).toEqual(["third", "second"]);
    // A search changed since it was chosen isn't copied, and counts change only with the history.
    await edit(record.id, "fourth", { kind: "query", query: "fourth", field: "title" });
    await expect(copy("other", "stale")).rejects.toThrow("That search changed. Choose it again.");
    await expect(edit("other", "patch-count", { kind: "patch", fields: { queryHistoryCount: 999 }, clear: [] })).rejects.toThrow("Validator error");
    expect(await entries("other", "query")).toEqual(["third", "second"]);
  });

  it("removes exactly the chosen entry of two with the same query and time", async () => {
    const { alice } = await setup();
    const timestamp = "2026-08-01T12:00:00Z";
    const twins = { queryHistory: [{ query: "tutoring", field: "title" as const, timestamp }, { query: "tutoring", field: "abstract" as const, timestamp }], questionHistory: [] };
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: [{ search: record, history: twins }] });
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "remove", command: { kind: "editSearch", id: record.id, edit: { kind: "removeQueryHistoryEntry", query: "tutoring", field: "abstract", timestamp } } });
    const left = (await alice.query(api.research.records.searchHistory, { accountId: "alice", id: record.id, kind: "query", paginationOpts })).page;
    expect(left).toEqual([{ text: "tutoring", field: "title", timestamp }]);
  });

  it("records a copy that changes only the history, so an earlier choice of that search is stale", async () => {
    const { alice } = await setup();
    const other = { queryHistory: [{ query: "other", field: "title" as const, timestamp: "2026-08-01T12:00:00Z" }], questionHistory: history.questionHistory };
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: [imported(record), { search: { ...record, id: "same-fields" }, history: other }, imported({ ...record, id: "third" })] });
    const get = async (id: string) => (await alice.query(api.research.records.getSearch, { accountId: "alice", id }))!;
    const chosen = await get("same-fields");
    const copy = (id: string, from: string, fromUpdatedAt: string, requestId: string) => alice.mutation(api.research.records.change, { accountId: "alice", requestId, command: { kind: "editSearch", id, edit: { kind: "copySearch", from, fromUpdatedAt, fields: {}, clear: [], summary: { queryHistoryCount: 1, questionCount: 1, questionText: "" } } } });
    await copy("same-fields", record.id, (await get(record.id)).updatedAt, "history-only");
    expect((await get("same-fields")).updatedAt).not.toBe(chosen.updatedAt);
    await expect(copy("third", "same-fields", chosen.updatedAt, "stale")).rejects.toThrow("That search changed. Choose it again.");
  });

  it("refuses a copy over a history too long to replace, and changes nothing", async () => {
    const { alice } = await setup();
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: [imported(record), imported({ ...record, id: "long" })] });
    const edit = (requestId: string, edit: unknown) => alice.mutation(api.research.records.change, { accountId: "alice", requestId, command: { kind: "editSearch", id: "long", edit } as never });
    for (let i = 0; i < 300; i++) await edit(`query-${i}`, { kind: "query", query: `query ${i}`, field: "title" });
    const before = await alice.query(api.research.records.getSearch, { accountId: "alice", id: "long" });
    const source = (await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id }))!;
    await expect(edit("copy", { kind: "copySearch", from: record.id, fromUpdatedAt: source.updatedAt, fields: { query: "copied" }, clear: [], summary: { queryHistoryCount: 1, questionCount: 1, questionText: "" } }))
      .rejects.toThrow("This search has more than 300 query history entries to replace.");
    expect(await alice.query(api.research.records.getSearch, { accountId: "alice", id: "long" })).toEqual(before);
    expect((await alice.query(api.research.records.searchHistory, { accountId: "alice", id: "long", kind: "query", paginationOpts: { cursor: null, numItems: 1 } })).page[0].text).toBe("query 299");
  });

  it("denies anonymous and cross-account access, including an account switch during import", async () => {
    const { t, alice, bob } = await setup();
    await alice.mutation(api.research.records.importBatch, batch);
    await expect(t.query(api.research.records.getSearch, { accountId: "alice", id: record.id })).rejects.toThrow();
    await expect(bob.mutation(api.research.records.importBatch, batch)).rejects.toThrow("Account changed");
    expect(await bob.query(api.research.records.getSearch, { accountId: "bob", id: record.id })).toBeNull();
    expect((await bob.query(api.research.records.listedSearches, { accountId: "bob", sort: "recent", paginationOpts })).page).toEqual([]);
    for (const query of [api.research.records.shortcuts, api.research.records.ratings]) {
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

  it("keeps the model's answer and its confidence when a person changes the answer (#334)", async () => {
    const { alice, t } = await setup();
    await alice.mutation(api.research.records.importBatch, batch);
    const respond = (requestId: string, by: "model" | "person", responses: Array<{ question: string; response: boolean | null; confidence?: number }>) =>
      alice.mutation(api.research.records.change, { accountId: "alice", requestId, command: { kind: "editSearch", id: record.id, edit: { kind: "responses", paperId: "W9", responses, by } } });
    await respond("model", "model", [{ question: "Randomized?", response: null, confidence: 0.4 }, { question: "Adults?", response: true, confidence: 0.9 }]);
    await respond("person", "person", [{ question: "Randomized?", response: true }]);
    const row = await t.run(ctx => ctx.db.query("screeningAnswers").filter(q => q.eq(q.field("paperId"), "W9")).unique());
    expect(row?.answers.map(({ question, answer, setBy, model }) => ({ question, answer, setBy, model: model && { answer: model.answer, confidence: model.confidence } }))).toEqual([
      { question: "Randomized?", answer: true, setBy: "person", model: { answer: null, confidence: 0.4 } },
      { question: "Adults?", answer: true, setBy: "model", model: { answer: true, confidence: 0.9 } },
    ]);
    // What the search shows is the current answer.
    const shown = (await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id }))?.screeningResponses.find(r => r.paperId === "W9");
    expect(shown?.responses).toEqual([{ question: "Randomized?", response: true }, { question: "Adults?", response: true }]);
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
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: [imported({ ...record, query: "local changed" })] });
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: [imported({ ...record, query: "local changed" })] });
    expect((await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id }))?.query).toBe(record.query);
    const rows = await t.run(ctx => ctx.db.query("searches").collect());
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.data.query).sort()).toEqual(["local changed", record.query]);
  });

  it("paginates beyond the first batch without losing records", async () => {
    const { alice } = await setup();
    for (let start = 0; start < 30; start += 10) await alice.mutation(api.research.records.importBatch, { accountId: "alice", searches: Array.from({ length: 10 }, (_, i) => imported({ ...record, id: `local-${start + i}` })), shortcuts: [], ratings: [] });
    const first = await alice.query(api.research.records.listedSearches, { accountId: "alice", sort: "recent", paginationOpts });
    const second = await alice.query(api.research.records.listedSearches, { accountId: "alice", sort: "recent", paginationOpts: { numItems: 25, cursor: first.continueCursor } });
    expect(first.isDone).toBe(false);
    expect(second.isDone).toBe(true);
    expect(new Set([...first.page, ...second.page].map(row => row.id)).size).toBe(30);
  });

  it("lists searches by date or result count without their answers, and finds them by their query or questions", async () => {
    const { alice } = await setup();
    const rows = [
      { ...record, id: "few", count: 5, query: "phonics instruction", createdAt: "2026-09-01T00:00:00.000Z" },
      { ...record, id: "many", count: 900, query: "tutoring", createdAt: "2026-09-02T00:00:00.000Z" },
      { ...record, id: "some", count: 50, query: "class size", createdAt: "2026-09-03T00:00:00.000Z" },
    ];
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: rows.map(search => ({ search })) });
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "ask", command: { kind: "editSearch", id: "some", edit: { kind: "question", question: "Do smaller classes help?" } } });
    const listed = async (args: { sort: "recent" | "oldest" | "most" | "least"; text?: string }) => (await alice.query(api.research.records.listedSearches, { accountId: "alice", paginationOpts, ...args })).page;

    expect((await listed({ sort: "oldest" })).map(row => row.id)).toEqual(["few", "many", "some"]);
    expect((await listed({ sort: "most" })).map(row => row.id)).toEqual(["many", "some", "few"]);
    expect((await listed({ sort: "least" })).map(row => row.id)).toEqual(["few", "some", "many"]);
    // Any part of the text matches, whatever its case, and the matches keep the sort.
    expect((await listed({ sort: "recent", text: "PHON" })).map(row => row.id)).toEqual(["few"]);
    expect((await listed({ sort: "recent", text: "smaller classes" })).map(row => row.id)).toEqual(["some"]);
    expect((await listed({ sort: "most", text: "in" })).map(row => row.id)).toEqual(["many", "few"]);
    expect((await listed({ sort: "recent" }))[0]).not.toHaveProperty("screeningResponses");
  });

  it("counts a person's searches as they're made and deleted, and clears them all a batch at a time", async () => {
    const { alice, bob, t } = await setup();
    const count = (as: typeof alice, accountId: string) => as.query(api.research.records.countSearches, { accountId });
    expect(await count(alice, "alice")).toBe(0);
    for (let start = 0; start < 60; start += 20) await alice.mutation(api.research.records.importBatch, { accountId: "alice", searches: Array.from({ length: 20 }, (_, i) => ({ search: { ...record, id: `search-${start + i}` } })), shortcuts: [], ratings: [] });
    await bob.mutation(api.research.records.importBatch, { accountId: "bob", searches: [{ search: { ...record, id: "bobs" } }], shortcuts: [], ratings: [] });
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "delete-one", command: { kind: "deleteSearch", id: "search-0" } });
    expect(await count(alice, "alice")).toBe(59);

    await alice.mutation(api.research.records.clearSearches, { accountId: "alice" });
    await t.finishAllScheduledFunctions(() => {});
    expect(await count(alice, "alice")).toBe(0);
    expect((await alice.query(api.research.records.listedSearches, { accountId: "alice", sort: "recent", paginationOpts })).page).toEqual([]);
    // Each cleared search leaves a revision that says it was deleted, and no one else's go.
    expect(await t.run(async ctx => (await ctx.db.query("searchRevisions").collect()).filter(row => row.deleted).length)).toBe(60);
    expect(await count(bob, "bob")).toBe(1);
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
    expect(await tools.research_records_getSearch.execute!({ id: record.id }, { ...call, toolCallId: "call-2" })).toEqual({ ...record, questionCount: 0, questionText: "", latestQuestion: undefined });
  });

  it("never reach another account's records", async () => {
    const { t, ids, alice } = await setup();
    await alice.mutation(api.research.records.importBatch, batch);
    const bobTools = assistantTools(actionCtx(t), ids.bob, USER_ACTIONS);
    expect(await bobTools.research_records_getSearch.execute!({ id: record.id }, { ...call, toolCallId: "call-3" })).toBeNull();
    await bobTools.research_records_change.execute!({ command: { kind: "deleteSearch", id: record.id } }, { ...call, toolCallId: "call-4" });
    expect(await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id })).toEqual(record);
  });

  it("refuse a sender whose account was suspended or deleted during the turn", async () => {
    const { t, ids } = await setup();
    const tools = assistantTools(actionCtx(t), ids.alice, USER_ACTIONS);
    for (const state of ["suspended", "deleted"] as const) {
      await t.run(ctx => ctx.db.patch("users", ids.alice, { state }));
      await expect(tools.research_records_getSearch.execute!({ id: record.id }, { ...call, toolCallId: `read-${state}` })).rejects.toThrow();
      await expect(tools.research_records_change.execute!({ command: { kind: "createSearch", search: record } }, { ...call, toolCallId: `write-${state}` })).rejects.toThrow();
    }
    expect(await t.run(ctx => ctx.db.query("searches").collect())).toEqual([]);
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
