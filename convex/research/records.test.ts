import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { applyCommand } from "./records";
import { answerPaper, ensureScreening } from "./answers";
import { ANSWERED_PAPERS_MAX, UNDO_SHORTCUT_MAX, restoreResponses, restoreSearch, serializeSearch, type ResearchCommand, type SavedSearch, type SearchEdit } from "../../lib/research/records";
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
  openAccessOnly: true, workTypes: ["article"], workLanguages: ["en"], institutionTypes: ["education"], funders: ["F123"], authors: ["A123"],
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
/** The record as a search's own read returns it: its answers are read apart, by paper. */
const { screeningResponses: _recordAnswers, ...listedRecord } = record;
type Signed = ReturnType<ReturnType<typeof convexTest>["withIdentity"]>;
/** Search `id`'s answers for these papers, now or at a screening version, read as a page does: at most 200 papers a read. */
async function answersOf(as: Signed, accountId: string, id: string, paperIds: string[], version?: number) {
  const reads = Array.from({ length: Math.ceil(paperIds.length / ANSWERED_PAPERS_MAX) }, (_, i) => paperIds.slice(i * ANSWERED_PAPERS_MAX, (i + 1) * ANSWERED_PAPERS_MAX));
  const pages = await Promise.all(reads.map(chunk => as.query(api.research.records.answersOf, { accountId, id, paperIds: chunk, ...(version === undefined ? {} : { version }) })));
  return restoreResponses(pages.flatMap(page => page.page));
}

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
    const papers = large.screeningResponses.map(row => row.paperId);
    const current = (version?: number, of = papers) => answersOf(alice, "alice", record.id, of, version);
    // After the first read of every paper, a few stand for the rest: each read is one lookup a paper.
    const some = ["W7", "W8", "W1499"];
    const expected = restoreSearch(large).screeningResponses;
    const count = (table: "screeningAnswers" | "screeningAnswerHistory" | "searchRevisions") => t.run(async ctx => (await ctx.db.query(table).collect()).length);
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: [imported(large)] });
    expect(await current()).toEqual(restoreSearch(large).screeningResponses);
    expect(await count("screeningAnswers")).toBe(1500);
    const history = await count("screeningAnswerHistory");
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "one-answer", command: { kind: "editSearch", id: record.id, edit: { kind: "responses", paperId: "W7", responses: [{ question, response: false }], by: "person" } } });
    expect(await count("screeningAnswerHistory")).toBe(history + 1);
    expect(await count("screeningAnswers")).toBe(1500);
    expect(await count("searchRevisions")).toBe(1);
    // Each revision names the screening version its answers stood at, and they read by paper as of it.
    for (let page = 2; page <= 25; page++) await alice.mutation(api.research.records.change, { accountId: "alice", requestId: `page-${page}`, command: { kind: "editSearch", id: record.id, edit: { kind: "patch", fields: { page }, clear: [] } } });
    const revisions = (await alice.query(api.research.records.revisions, { accountId: "alice", id: record.id, paginationOpts })).page;
    expect(revisions).toHaveLength(25);
    expect(await current(revisions.at(-1)!.answersVersion, some)).toEqual(Object.fromEntries(some.map(paperId => [paperId, expected[paperId]])));
    expect((await current(revisions[0].answersVersion, some)).W7[question]).toBe(false);
    expect((await current(undefined, some)).W7[question]).toBe(false);
    await expect(alice.query(api.research.records.answersOf, { accountId: "alice", id: record.id, paperIds: papers.slice(0, ANSWERED_PAPERS_MAX + 1) })).rejects.toThrow("200 papers at a time");
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
    expect(await answersOf(alice, "alice", record.id, ["W1"])).toEqual(original.screeningResponses);
  });
  it("imports every saved field once, and preserves subsequent cloud edits on retry", async () => {
    const { alice, t } = await setup();
    await alice.mutation(api.research.records.importBatch, batch);
    await alice.mutation(api.research.records.importBatch, batch);
    expect(await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id })).toEqual(listedRecord);
    expect((await alice.query(api.research.records.listedShortcuts, { accountId: "alice", sort: "recent", paginationOpts })).page).toEqual(batch.shortcuts);
    expect((await alice.query(api.research.records.ratings, { accountId: "alice", paginationOpts })).page).toEqual(batch.ratings);
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "edit-query", command: { kind: "editSearch", id: record.id, edit: { kind: "query", query: "updated", field: "abstract" } } });
    await alice.mutation(api.research.records.importBatch, batch);
    const after = await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id });
    expect(after?.query).toBe("updated");
    const recordPapers = record.screeningResponses.map(row => row.paperId);
    expect(await answersOf(alice, "alice", record.id, recordPapers)).toEqual(restoreSearch(record).screeningResponses);
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
    expect((await bob.query(api.research.records.listedShortcuts, { accountId: "bob", sort: "recent", paginationOpts })).page).toEqual([]);
    expect((await bob.query(api.research.records.ratings, { accountId: "bob", paginationOpts })).page).toEqual([]);
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
    expect(revisions.page[1].data).toEqual(listedRecord);
    expect(await answersOf(alice, "alice", record.id, ["W1", "W2"], revisions.page[0].answersVersion)).toEqual({ W1: { "Randomized?": false }, W2: { "Randomized?": false } });
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
    expect(await answersOf(alice, "alice", record.id, ["W9"])).toEqual({ W9: { "Randomized?": true, "Adults?": true } });
  });

  it("merges independent paper answers and removes only a renamed question's answers", async () => {
    const { alice } = await setup();
    await alice.mutation(api.research.records.importBatch, batch);
    for (const paperId of ["W1", "W2"]) await alice.mutation(api.research.records.change, { accountId: "alice", requestId: paperId, command: { kind: "editSearch", id: record.id, edit: { kind: "responses", paperId, responses: [{ question: "Adults?", response: true }] } } });
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "rename", command: { kind: "editSearch", id: record.id, edit: { kind: "replaceScreeningQuestion", question: "Randomized?", replacement: "Trial?" } } });
    expect(await answersOf(alice, "alice", record.id, ["W1", "W2"])).toEqual({ W1: { "Adults?": true }, W2: { "Adults?": true } });
  });

  it("takes answers from every paper at once for every reader, cleans the rows a page at a time, and keeps any answer given since (#421)", async () => {
    vi.useFakeTimers();
    try {
      const { alice, t, ids } = await setup();
      // More papers than one page of a sweep reads.
      const papers = Array.from({ length: 450 }, (_, i) => `W${i}`);
      const large = { ...record, screeningQuestions: [{ question: "Randomized?" }, { question: "Adults?" }], screeningResponses: papers.map(paperId => ({ paperId, responses: [{ question: "Randomized?", response: true }, { question: "Adults?", response: false }] })) };
      await alice.mutation(api.research.records.importBatch, { ...batch, searches: [imported(large)] });
      const edit = (requestId: string, value: unknown) => alice.mutation(api.research.records.change, { accountId: "alice", requestId, command: { kind: "editSearch", id: record.id, edit: value } as never });
      const rows = () => t.run(async ctx => (await ctx.db.query("screeningAnswers").take(500)).length);

      const adults = { kind: "responses", paperId: "W99", responses: [{ question: "Adults?", response: false }], by: "person" };
      await edit("first", adults);
      await edit("drop", { kind: "removeQuestionResponses", question: "Adults?" });
      // W99 is the last paper a later page reaches. Its answer is gone for every reader already.
      expect(await answersOf(alice, "alice", record.id, ["W0", "W99"])).toEqual({ W0: { "Randomized?": true }, W99: { "Randomized?": true } });
      const [made] = (await alice.query(api.research.records.revisions, { accountId: "alice", id: record.id, paginationOpts })).page;
      expect(await answersOf(alice, "alice", record.id, ["W99"], made.answersVersion)).toEqual({ W99: { "Randomized?": true } });
      // Given again before the sweep reaches it, even the same answer as before, it stays.
      await edit("again", adults);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await answersOf(alice, "alice", record.id, papers)).toEqual(Object.fromEntries(papers.map(paperId => [paperId, paperId === "W99" ? { "Randomized?": true, "Adults?": false } : { "Randomized?": true }])));
      // The revision still reads as the edit left it, and the one before it as it was.
      const revisions = (await alice.query(api.research.records.revisions, { accountId: "alice", id: record.id, paginationOpts })).page;
      expect(await answersOf(alice, "alice", record.id, ["W98", "W99"], revisions[0].answersVersion)).toEqual({ W98: { "Randomized?": true }, W99: { "Randomized?": true } });
      expect(await answersOf(alice, "alice", record.id, ["W98"], revisions[1].answersVersion)).toEqual({ W98: { "Randomized?": true, "Adults?": false } });
      // Every row has taken the removal, so the screening forgets it.
      expect(await t.run(async ctx => (await ctx.db.query("screenings").first())?.removals ?? [])).toEqual([]);

      await edit("clear", { kind: "clearResponses" });
      // The model's answer arrives late for a paper a person had answered: the person's answer went with the clear.
      const screening = (await t.run(ctx => ctx.db.query("screenings").first()))!;
      await t.run(ctx => answerPaper(ctx, screening._id, "W99", [{ question: "Randomized?", response: false }], "model", 1));
      expect(await rows()).toBeGreaterThan(1);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await answersOf(alice, "alice", record.id, papers)).toEqual({ W99: { "Randomized?": false } });
      expect(await rows()).toBe(1);
      expect(ids.alice).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes no revision for a removal that finds nothing to take, and saves a paper listed twice once (#421)", async () => {
    const { alice, t } = await setup();
    const twice = { ...record, screeningResponses: [{ paperId: "W1", responses: [{ question: "Randomized?", response: true }] }, { paperId: "W1", responses: [{ question: "Randomized?", response: false }] }] };
    await alice.mutation(api.research.records.importBatch, { ...batch, searches: [imported(twice)] });
    expect(await answersOf(alice, "alice", record.id, ["W1"])).toEqual({ W1: { "Randomized?": false } });
    const revisions = () => t.run(async ctx => (await ctx.db.query("searchRevisions").take(10)).length);
    const before = await revisions();
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "nothing", command: { kind: "editSearch", id: record.id, edit: { kind: "removeQuestionResponses", question: "Never asked?" } } });
    expect(await revisions()).toBe(before);
    expect(await answersOf(alice, "alice", record.id, ["W1"])).toEqual({ W1: { "Randomized?": false } });
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
    // A search left out doesn't take a place on the page.
    expect((await alice.query(api.research.records.listedSearches, { accountId: "alice", sort: "oldest", exclude: "few", paginationOpts: { cursor: null, numItems: 2 } })).page.map(row => row.id)).toEqual(["many", "some"]);
  });

  it("counts a person's searches as they're made and deleted, and clears them all a batch at a time", async () => {
    const { alice, bob, t } = await setup();
    const count = (as: typeof alice, accountId: string) => as.query(api.research.records.countSearches, { accountId });
    expect(await count(alice, "alice")).toBe(0);
    for (let start = 0; start < 60; start += 20) await alice.mutation(api.research.records.importBatch, { accountId: "alice", searches: Array.from({ length: 20 }, (_, i) => ({ search: { ...record, id: `search-${start + i}` } })), shortcuts: [], ratings: [] });
    await bob.mutation(api.research.records.importBatch, { accountId: "bob", searches: [{ search: { ...record, id: "bobs" } }], shortcuts: [], ratings: [] });
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "delete-one", command: { kind: "deleteSearch", id: "search-0" } });
    await t.finishAllScheduledFunctions(() => {});
    expect(await count(alice, "alice")).toBe(59);

    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "clear", command: { kind: "clearSearches" } });
    await t.finishAllScheduledFunctions(() => {});
    expect(await count(alice, "alice")).toBe(0);
    expect((await alice.query(api.research.records.listedSearches, { accountId: "alice", sort: "recent", paginationOpts })).page).toEqual([]);
    // Each cleared search leaves a revision that says it was deleted, and no one else's go.
    expect(await t.run(async ctx => (await ctx.db.query("searchRevisions").collect()).filter(row => row.deleted).length)).toBe(60);
    expect(await count(bob, "bob")).toBe(1);
  });

  it("reads the person's ratings of the papers asked for, and no one else's", async () => {
    const { alice, bob } = await setup();
    const rate = (as: typeof alice, accountId: string, paperId: string, rating: number) => as.mutation(api.research.records.change, { accountId, requestId: `${accountId}-${paperId}`, command: { kind: "rating", paperId, rating } });
    await rate(alice, "alice", "W1", 4);
    await rate(alice, "alice", "W2", 0);
    await rate(alice, "alice", "W3", 5);
    await rate(bob, "bob", "W1", 1);

    expect((await alice.query(api.research.records.ratingsOf, { accountId: "alice", paperIds: ["W2", "W9", "W1"] })).page).toEqual([{ paperId: "W2", rating: 0 }, { paperId: "W1", rating: 4 }]);
    expect((await bob.query(api.research.records.ratingsOf, { accountId: "bob", paperIds: ["W1", "W3"] })).page).toEqual([{ paperId: "W1", rating: 1 }]);
    await expect(alice.query(api.research.records.ratingsOf, { accountId: "alice", paperIds: Array.from({ length: 201 }, (_, i) => `W${i}`) })).rejects.toThrow("200 papers at a time");
  });

  it("lists, finds, counts, reads by name and clears the person's shortcuts, and no one else's", async () => {
    const { alice, bob, t } = await setup();
    const save = (as: typeof alice, accountId: string, shorthand: string, expansion: string, createdAt: number) => as.mutation(api.research.records.change, { accountId, requestId: `${accountId}-${shorthand}`, command: { kind: "shortcut", shorthand, value: { expansion, createdAt } } });
    await save(alice, "alice", "rct", "randomized controlled trial", 3);
    await save(alice, "alice", "Africa", "Kenya OR Ghana", 1);
    await save(alice, "alice", "ml", "machine learning", 2);
    await save(bob, "bob", "rct", "bob's own", 9);
    await t.finishAllScheduledFunctions(() => {});
    const listed = async (args: { sort: "recent" | "oldest" | "alpha" | "alpha-desc"; text?: string }) => (await alice.query(api.research.records.listedShortcuts, { accountId: "alice", paginationOpts, ...args })).page.map(row => row.shorthand);

    expect(await listed({ sort: "recent" })).toEqual(["rct", "ml", "Africa"]);
    expect(await listed({ sort: "oldest" })).toEqual(["Africa", "ml", "rct"]);
    // By name, whatever its case.
    expect(await listed({ sort: "alpha" })).toEqual(["Africa", "ml", "rct"]);
    expect(await listed({ sort: "alpha-desc" })).toEqual(["rct", "ml", "Africa"]);
    expect(await listed({ sort: "alpha", text: "LEARN" })).toEqual(["ml"]);
    expect(await listed({ sort: "alpha", text: "r" })).toEqual(["Africa", "ml", "rct"]);
    expect(await alice.query(api.research.records.countShortcuts, { accountId: "alice" })).toBe(3);

    expect((await alice.query(api.research.records.shortcutsOf, { accountId: "alice", names: ["rct", "nope", "ml"] })).page).toEqual([
      { shorthand: "rct", expansion: "randomized controlled trial", createdAt: 3 },
      { shorthand: "ml", expansion: "machine learning", createdAt: 2 },
    ]);
    await expect(alice.query(api.research.records.shortcutsOf, { accountId: "alice", names: Array.from({ length: 16 }, (_, i) => `n${i}`) })).rejects.toThrow("15 names at a time");

    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "clear", command: { kind: "clearShortcuts" } });
    await t.finishAllScheduledFunctions(() => {});
    expect(await listed({ sort: "recent" })).toEqual([]);
    expect(await alice.query(api.research.records.countShortcuts, { accountId: "alice" })).toBe(0);
    expect((await bob.query(api.research.records.shortcutsOf, { accountId: "bob", names: ["rct"] })).page).toEqual([{ shorthand: "rct", expansion: "bob's own", createdAt: 9 }]);
  });

  it("leaves a search saved while the history is still being cleared", async () => {
    vi.useFakeTimers();
    try {
      const { alice, t } = await setup();
      for (const start of [0, 13]) await alice.mutation(api.research.records.importBatch, { accountId: "alice", searches: Array.from({ length: 13 }, (_, i) => ({ search: { ...record, id: `old-${start + i}` } })), shortcuts: [], ratings: [] });
      // The clock stands still: the old searches, the clear and the new search share a millisecond.
      // The first batch is gone; the second waits for its turn.
      await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "clear", command: { kind: "clearSearches" } });
      await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "new", command: { kind: "createSearch", search: { ...record, id: "new" } } });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await alice.query(api.research.records.listedSearches, { accountId: "alice", sort: "recent", paginationOpts })).page.map(row => row.id)).toEqual(["new"]);
      expect(await alice.query(api.research.records.countSearches, { accountId: "alice" })).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes a first count a page at a time, right through searches saved and deleted meanwhile", async () => {
    const { alice, ids, t } = await setup();
    // 1,200 searches from before counts were kept, so none is counted yet.
    const stored = (i: number) => ({ userId: ids.alice, localId: `old-${i}`, revision: 1, data: { ...record, id: `old-${i}`, screeningResponses: [] } });
    for (let start = 0; start < 1_200; start += 300) await t.run(async ctx => { for (let i = start; i < start + 300; i++) await ctx.db.insert("searches", stored(i)); });
    const change = (requestId: string, command: ResearchCommand) => alice.mutation(api.research.records.change, { accountId: "alice", requestId, command });
    const row = () => t.run(ctx => ctx.db.query("recordCounts").withIndex("by_user_and_table", q => q.eq("userId", ids.alice).eq("table", "searches")).unique());

    vi.useFakeTimers();
    try {
      // The first save starts the count; one step reaches the first 500.
      await change("first", { kind: "createSearch", search: { ...record, id: "first" } });
      await t.mutation(internal.research.records.countRecordsPage, { table: "searches", userId: ids.alice });
      expect(await row()).toMatchObject({ count: 500 });
      await change("counted", { kind: "deleteSearch", id: "old-0" });
      await change("not-reached", { kind: "deleteSearch", id: "old-1100" });
      await change("second", { kind: "createSearch", search: { ...record, id: "second" } });
      expect(await row()).toMatchObject({ count: 499 });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
    expect(await row()).toEqual(expect.objectContaining({ count: 1_200 }));
    expect((await row())?.countedTo).toBeUndefined();
    await change("after", { kind: "deleteSearch", id: "second" });
    expect(await alice.query(api.research.records.countSearches, { accountId: "alice" })).toBe(1_199);
  });
});

describe("undoing a change to research records (#342)", () => {
  async function changing() {
    const { t, alice } = await setup();
    await alice.mutation(api.research.records.importBatch, batch);
    let requests = 0;
    const change = (command: ResearchCommand) => alice.mutation(api.research.records.change, { accountId: "alice", requestId: `undo-${requests++}`, command });
    const search = async () => (await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id }))!;
    return { t, alice, change, search, edit: (edit: SearchEdit) => change({ kind: "editSearch", id: record.id, edit }) };
  }

  it("puts a search's query and filters back as a new revision, and adds the query it went back to to its history", async () => {
    const { alice, change, search, edit } = await changing();
    const before = await search();

    const requeried = await edit({ kind: "query", query: "tutoring africa", field: "title" });
    expect(requeried.undo?.args.command).toEqual({ kind: "editSearch", id: record.id, edit: { kind: "restore", revision: 1, expect: 2 } });
    const filtered = await edit({ kind: "patch", fields: { minCitations: 10 }, clear: ["language"] });
    expect(filtered.undo?.args.command).toEqual({ kind: "editSearch", id: record.id, edit: { kind: "restore", revision: 2, expect: 3 } });

    // Undo the filter change: the query stays, since it wasn't part of that change.
    const unfiltered = await change(filtered.undo!.args.command);
    expect(await search()).toMatchObject({ query: "tutoring africa", minCitations: before.minCitations, language: before.language });
    // Undoing that undo is restoring what it replaced.
    expect(unfiltered.undo?.args.command).toEqual({ kind: "editSearch", id: record.id, edit: { kind: "restore", revision: 3, expect: 4 } });

    // Going back to the first revision brings the old query back and counts it as one more query.
    await edit({ kind: "restore", revision: 1 });
    const restored = await search();
    expect(restored).toMatchObject({ query: before.query, field: before.field, queryHistoryCount: before.queryHistoryCount + 2 });
    const { queryHistoryCount: _count, updatedAt: _updated, ...fields } = restored;
    const { queryHistoryCount: _countBefore, updatedAt: _updatedBefore, ...fieldsBefore } = before;
    expect(fields).toEqual(fieldsBefore);
    const revisions = await alice.query(api.research.records.revisions, { accountId: "alice", id: record.id, paginationOpts });
    expect(revisions.page.map(row => row.revision)).toEqual([5, 4, 3, 2, 1]);
    const history = await alice.query(api.research.records.searchHistory, { accountId: "alice", id: record.id, kind: "query", paginationOpts });
    expect(history.page.slice(0, 2).map(entry => entry.text)).toEqual([before.query, "tutoring africa"]);
  });

  it("refuses to undo a change once the search has changed again, and leaves it as it is", async () => {
    const { change, search, edit } = await changing();
    const filtered = await edit({ kind: "patch", fields: { minCitations: 10 }, clear: [] });
    await edit({ kind: "patch", fields: { sortBy: "publication_date:desc" }, clear: [] });
    await expect(change(filtered.undo!.args.command)).rejects.toThrow(/changed since/);
    expect(await search()).toMatchObject({ minCitations: 10, sortBy: "publication_date:desc" });
    await expect(edit({ kind: "restore", revision: 99 })).rejects.toThrow(/wasn't kept/);
  });

  it("offers no undo for what it can't put back: deleting, questions and answers, or a change that changed nothing", async () => {
    const { change, edit } = await changing();
    expect((await edit({ kind: "addScreeningQuestion", question: "Adults?" })).undo).toBeUndefined();
    expect((await edit({ kind: "question", question: "For whom?" })).undo).toBeUndefined();
    expect((await edit({ kind: "responses", paperId: "W9", responses: [{ question: "Adults?", response: true }] })).undo).toBeUndefined();
    expect((await edit({ kind: "patch", fields: { minCitations: record.minCitations }, clear: [] })).undo).toBeUndefined();
    // A change that also touches what a restore leaves alone would only be half undone, so it has none either.
    expect((await edit({ kind: "patch", fields: { minCitations: 50, screeningQuestions: [{ question: "Children?" }] }, clear: [] })).undo).toBeUndefined();
    expect((await edit({ kind: "patch", fields: { minCitations: 60, chatJobIdsByAccountId: { alice: "later-chat" } }, clear: [] })).undo).toBeUndefined();
    expect((await change({ kind: "rating", paperId: "W1", rating: null })).undo).toBeUndefined();
    expect((await change({ kind: "shortcut", shorthand: "none", value: null })).undo).toBeUndefined();
    expect((await change({ kind: "deleteSearch", id: record.id })).undo).toBeUndefined();
  });

  it("keeps the chats started from a search when it is restored", async () => {
    const { search, edit } = await changing();
    await edit({ kind: "patch", fields: { minCitations: 10 }, clear: [] });
    await edit({ kind: "patch", fields: { chatJobIdsByAccountId: { alice: "later-chat" } }, clear: [] });
    await edit({ kind: "restore", revision: 1 });
    expect(await search()).toMatchObject({ minCitations: record.minCitations, chatJobIdsByAccountId: { alice: "later-chat" } });
  });

  it("answers a retried request with the same undo", async () => {
    const { alice } = await changing();
    const args = { accountId: "alice", requestId: "twice", command: { kind: "rating" as const, paperId: "W78", rating: 2 } };
    const first = await alice.mutation(api.research.records.change, args);
    expect(first.undo?.args.command).toEqual({ kind: "rating", paperId: "W78", rating: null, expect: 2 });
    expect(await alice.mutation(api.research.records.change, args)).toEqual(first);
  });

  it("reverses making a search, a shortcut and a rating, unless they changed again", async () => {
    const { t, alice, change } = await changing();
    const made = await change({ kind: "createSearch", search: { ...record, id: "made", screeningResponses: [] } });
    expect(made.undo?.args.command).toEqual({ kind: "deleteSearch", id: "made", expect: { created: expect.any(Number), revision: 1, updatedAt: record.updatedAt } });
    await change(made.undo!.args.command);
    expect(await alice.query(api.research.records.getSearch, { accountId: "alice", id: "made" })).toBeNull();
    // A search worked on since it was made isn't deleted by undoing its creation.
    const kept = await change({ kind: "createSearch", search: { ...record, id: "kept", screeningResponses: [] } });
    await change({ kind: "editSearch", id: "kept", edit: { kind: "query", query: "worked on", field: "title" } });
    await expect(change(kept.undo!.args.command)).rejects.toThrow(/changed since/);
    expect(await alice.query(api.research.records.getSearch, { accountId: "alice", id: "kept" })).toMatchObject({ query: "worked on" });
    // Nor is one a screening job has answered into, which leaves the search itself untouched.
    const screened = await change({ kind: "createSearch", search: { ...record, id: "screened", screeningResponses: [] } });
    await t.run(async ctx => {
      const search = (await ctx.db.query("searches").collect()).find(row => row.localId === "screened")!;
      await answerPaper(ctx, (await ensureScreening(ctx, search.userId, search._id))._id, "W5", [{ question: "Randomized?", response: true }], "model", 1);
    });
    await expect(change(screened.undo!.args.command)).rejects.toThrow(/changed since/);
    // Nor a search made again under the same ID after the first was deleted.
    const first = await change({ kind: "createSearch", search: { ...record, id: "again", screeningResponses: [] } });
    await change({ kind: "deleteSearch", id: "again" });
    await change({ kind: "createSearch", search: { ...record, id: "again", screeningResponses: [] } });
    await expect(change(first.undo!.args.command)).rejects.toThrow(/changed since/);

    const shortcut = async (shorthand: string) => (await alice.query(api.research.records.shortcutsOf, { accountId: "alice", names: [shorthand] })).page;
    const added = await change({ kind: "shortcut", shorthand: "qe", value: { expansion: "quasi-experimental", createdAt: 1 } });
    expect(added.undo?.args.command).toEqual({ kind: "shortcut", shorthand: "qe", value: null, expect: { expansion: "quasi-experimental", createdAt: 1 } });
    const reworded = await change({ kind: "shortcut", shorthand: "qe", value: { expansion: "quasi experiment", createdAt: 1 } });
    await expect(change(added.undo!.args.command)).rejects.toThrow(/changed since/);
    await change(reworded.undo!.args.command);
    expect((await shortcut("qe")).map(row => row.expansion)).toEqual(["quasi-experimental"]);
    // Setting it to what it already is has nothing to undo.
    expect((await change({ kind: "shortcut", shorthand: "qe", value: { expansion: "quasi-experimental", createdAt: 1 } })).undo).toBeUndefined();
    // Saved again with the same words at a later time, it's a later shortcut: the first undo leaves it.
    const resaved = await change({ kind: "shortcut", shorthand: "qe", value: { expansion: "quasi-experimental", createdAt: 2 } });
    await expect(change(added.undo!.args.command)).rejects.toThrow(/changed since/);
    await change(resaved.undo!.args.command);
    await change(added.undo!.args.command);
    expect(await shortcut("qe")).toEqual([]);
    // One too long to keep with the request has no undo.
    expect((await change({ kind: "shortcut", shorthand: "long", value: { expansion: "x".repeat(UNDO_SHORTCUT_MAX + 1), createdAt: 1 } })).undo).toBeUndefined();

    const rating = async () => (await alice.query(api.research.records.ratingsOf, { accountId: "alice", paperIds: ["W77"] })).page.map(row => row.rating);
    const rated = await change({ kind: "rating", paperId: "W77", rating: 3 });
    expect(rated.undo?.args.command).toEqual({ kind: "rating", paperId: "W77", rating: null, expect: 3 });
    const rerated = await change({ kind: "rating", paperId: "W77", rating: 5 });
    await expect(change(rated.undo!.args.command)).rejects.toThrow(/changed since/);
    await change(rerated.undo!.args.command);
    expect(await rating()).toEqual([3]);
    // Setting it to what it already is has nothing to undo.
    expect((await change({ kind: "rating", paperId: "W77", rating: 3 })).undo).toBeUndefined();
    await change(rated.undo!.args.command);
    expect(await rating()).toEqual([]);
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
    expect(await tools.research_records_getSearch.execute!({ id: record.id }, { ...call, toolCallId: "call-2" })).toEqual({ ...listedRecord, questionCount: 0, questionText: "", latestQuestion: undefined });
    // It reads the search's answers as a page does: by paper.
    expect(await tools.research_records_answersOf.execute!({ id: record.id, paperIds: record.screeningResponses.map(row => row.paperId) }, { ...call, toolCallId: "call-2b" })).toMatchObject({ page: record.screeningResponses });
  });

  it("never reach another account's records", async () => {
    const { t, ids, alice } = await setup();
    await alice.mutation(api.research.records.importBatch, batch);
    const bobTools = assistantTools(actionCtx(t), ids.bob, USER_ACTIONS);
    expect(await bobTools.research_records_getSearch.execute!({ id: record.id }, { ...call, toolCallId: "call-3" })).toBeNull();
    await bobTools.research_records_change.execute!({ command: { kind: "deleteSearch", id: record.id } }, { ...call, toolCallId: "call-4" });
    expect(await alice.query(api.research.records.getSearch, { accountId: "alice", id: record.id })).toEqual(listedRecord);
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
