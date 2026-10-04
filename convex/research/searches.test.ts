// The assistant's tools for saved searches (#327): plain settings in, the saved search's own
// fields out, one undo for each change, and a page of results read from OpenAlex.
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

type Request = { url: URL };
let requests: Request[] = [];
/** OpenAlex, answering a page with as many works as it's asked for, of a search that has 57. */
const openAlex = vi.fn(async (input: string | URL) => {
  const url = new URL(String(input));
  requests.push({ url });
  const [page, size] = [Number(url.searchParams.get("page")), Number(url.searchParams.get("per-page"))];
  const start = (page - 1) * size;
  // A search for "verbose" finds papers whose every text runs long.
  const long = decodeURIComponent(url.search).includes("verbose") ? "x".repeat(900) : "";
  const results = Array.from({ length: Math.max(0, Math.min(size, 57 - start)) }, (_, i) => ({
    id: `https://openalex.org/W${start + i + 1}`,
    display_name: `Paper ${start + i + 1}${long}`,
    publication_year: 2020,
    cited_by_count: 12,
    abstract_inverted_index: Object.fromEntries(Array.from({ length: 120 }, (_, word) => [`word${word}`, [word]])),
    authorships: ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Edsger Dijkstra"].map((name) => ({ author: { display_name: name + long } })),
    primary_location: { source: { display_name: `A journal${long}` } },
  }));
  return new Response(JSON.stringify({ meta: { count: 57 }, results }), { status: 200 });
});

beforeEach(() => {
  requests = [];
  vi.stubEnv("OPENALEX_API_KEY", "platform-key");
  vi.stubEnv("OPENALEX_CONTACT_EMAIL", "contact@example.test");
  vi.stubGlobal("fetch", openAlex);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    for (const clerkId of ["alice", "bob"]) await ctx.db.insert("users", { libraryItemCount: 0, clerkId, email: `${clerkId}@example.com`, state: "active", createdAt: 1, updatedAt: 1 });
  });
  const alice = t.withIdentity({ subject: "alice" });
  const { create, update, restore, remove, results } = api.research.searches;
  const search = (id: string) => alice.query(api.research.records.getSearch, { accountId: "alice", id });
  /** What the results page writes as a search is read: its result count and the page last opened. */
  const change = (command: FunctionArgs<typeof api.research.records.change>["command"]) => alice.mutation(api.research.records.change, { accountId: "alice", requestId: `change-${Math.random()}`, command });
  const opened = (id: string, count = 57, page = 2) => change({ kind: "editSearch", id, edit: { kind: "patch", fields: { count, page }, clear: [] } });
  return { t, alice, bob: t.withIdentity({ subject: "bob" }), create, update, restore, remove, results, search, opened, change };
}

describe("the assistant's search tools", () => {
  it("make a search from plain settings, and take it back only while nothing has been done with it", async () => {
    const { alice, create, update, remove, search, opened } = await setup();
    const made = await alice.mutation(create, { query: " tutoring AND \"primary school\" ", fromYear: 2015, toYear: 2024, openAccessOnly: true, sort: "most_cited" });
    expect(await search(made.id)).toMatchObject({
      query: 'tutoring AND "primary school"', field: "title_and_abstract", yearRange: [2015, 2024], isYearRangeEnabled: true, filterType: "year", openAccessOnly: true, sortBy: "cited_by_count:desc", queryHistoryCount: 1,
    });
    expect(made.undo).toMatchObject({ path: "research/searches:remove", args: { id: made.id } });
    // Opening it, which writes its result count, isn't work done with it: it can still be taken back.
    await opened(made.id);
    await alice.mutation(remove, made.undo!.args);
    expect(await search(made.id)).toBeNull();

    // One whose filters were changed since stays.
    const kept = await alice.mutation(create, { query: "tutoring" });
    await alice.mutation(update, { id: kept.id, reviewsOnly: true });
    await expect(alice.mutation(remove, kept.undo!.args)).rejects.toThrow(/changed since/);
    // Naming the revision it's at now doesn't pass it off as untouched.
    await expect(alice.mutation(remove, { id: kept.id, expect: { ...kept.undo!.args.expect, revision: 2 } })).rejects.toThrow(/changed since/);
    expect(await search(kept.id)).not.toBeNull();
    await expect(alice.mutation(create, { query: "  " })).rejects.toThrow(/needs a query/);
    await expect(alice.mutation(create, { query: "tutoring", fromYear: 2020.5 })).rejects.toThrow(/whole number/);
    await expect(alice.mutation(create, { query: "tutoring", minCitations: -1 })).rejects.toThrow(/whole number/);
  });

  it("change a search's query and filters together, with one undo that puts both back", async () => {
    const { alice, create, update, restore, search, opened } = await setup();
    const { id } = await alice.mutation(create, { query: "tutoring", fromYear: 2010, minCitations: 5 });
    // The person has it open, on its second page.
    await opened(id);
    const changed = await alice.mutation(update, { id, query: "tutoring AND randomized", field: "title", toYear: 2020, withAbstractOnly: true, minCitations: null });
    // The changed search's results start from their first page.
    expect(await search(id)).toMatchObject({ query: "tutoring AND randomized", field: "title", yearRange: [2010, 2020], hasAbstract: true, queryHistoryCount: 2, page: 1 });
    expect((await search(id))!.minCitations).toBeUndefined();
    expect(changed.undo).toEqual({ path: "research/searches:restore", args: { id, revision: 2, expect: 4 } });

    // The results page reads the changed search and writes its count: the undo still goes through,
    // and brings back the count and the page the search had, which nothing would read again.
    await opened(id, 10, 1);
    const back = await alice.mutation(restore, changed.undo!.args);
    expect(await search(id)).toMatchObject({ query: "tutoring", field: "title_and_abstract", minCitations: 5, count: 57, page: 2 });
    expect((await search(id))!.hasAbstract).toBeUndefined();
    // And the undo of that undo is the change again.
    await alice.mutation(restore, back.undo!.args);
    expect(await search(id)).toMatchObject({ query: "tutoring AND randomized", yearRange: [2010, 2020] });

    // Changed again since, an older undo leaves it. Giving what it already has changes nothing.
    await alice.mutation(update, { id, reviewsOnly: true });
    await expect(alice.mutation(restore, changed.undo!.args)).rejects.toThrow(/changed since/);
    expect((await alice.mutation(update, { id, reviewsOnly: true })).undo).toBeUndefined();
    // Both years taken off: the year filter goes.
    await alice.mutation(update, { id, fromYear: null, toYear: null });
    expect(await search(id)).toMatchObject({ isYearRangeEnabled: false });
    await expect(alice.mutation(update, { id, fromYear: 2021, toYear: 2020 })).rejects.toThrow(/first year is after/);
    // A blank query changes nothing, the filters given with it included.
    await expect(alice.mutation(update, { id, query: "   ", openAccessOnly: true })).rejects.toThrow(/needs a query/);
    expect((await search(id))!.openAccessOnly).toBeUndefined();
  });

  it("read a page of a search's results, ten papers at a time, with how many it has in all", async () => {
    const { alice, bob, create, results, search, change } = await setup();
    const { id } = await alice.mutation(create, { query: "tutoring", sort: "newest" });
    const page = await alice.action(results, { id, page: 6 });
    expect(page).toMatchObject({ total: 57, page: 6, pages: 6 });
    // Its history shows the count from now on, without its page being opened.
    expect((await search(id))!.count).toBe(57);
    expect(page.papers.map((paper) => paper.id)).toEqual(Array.from({ length: 7 }, (_, i) => `https://openalex.org/W${51 + i}`));
    expect(page.papers[0]).toMatchObject({ title: "Paper 51", authors: "Ada Lovelace, Alan Turing, Grace Hopper and others", year: 2020, venue: "A journal", citations: 12 });
    // An abstract is cut, so ten papers stay short enough for the model to read at once.
    expect(page.papers[0].abstract!.length).toBeLessThanOrEqual(301);
    expect(JSON.stringify(await alice.action(results, { id })).length).toBeLessThan(8_000);
    // One request a page, for only that page, in the search's own order.
    expect(requests).toHaveLength(2);
    expect(Object.fromEntries(requests[0].url.searchParams)).toMatchObject({ page: "6", "per-page": "10", sort: "publication_date:desc" });
    expect(decodeURIComponent(requests[0].url.search)).toContain("tutoring");

    // Someone else's search isn't read.
    await expect(bob.action(results, { id })).rejects.toThrow(/not found/i);
    await expect(alice.action(results, { id, page: 0 })).rejects.toThrow(/count from 1/);
    // A page OpenAlex wouldn't answer isn't asked for.
    await expect(alice.action(results, { id, page: 1_001 })).rejects.toThrow(/up to page 1,000/);
    expect(requests).toHaveLength(2);

    // Ten papers whose every text runs long are still read whole.
    const verbose = await alice.mutation(create, { query: "verbose" });
    const wordy = await alice.action(results, { id: verbose.id });
    expect(wordy.papers).toHaveLength(10);
    expect(JSON.stringify(wordy).length).toBeLessThan(8_000);

    // A search that keeps only rated papers returns those, as its page shows them.
    await change({ kind: "editSearch", id, edit: { kind: "patch", fields: { onlyRatedPapers: true, ratingRange: [4, 5] }, clear: [] } });
    await change({ kind: "rating", paperId: "https://openalex.org/W2", rating: 5 });
    await change({ kind: "rating", paperId: "https://openalex.org/W3", rating: 2 });
    expect((await alice.action(results, { id })).papers.map((paper) => paper.id)).toEqual(["https://openalex.org/W2"]);
  });
});
