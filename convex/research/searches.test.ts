// The assistant's tools for saved searches (#327): plain settings in, the saved search's own
// fields out, one undo for each change, and a page of results read from OpenAlex.
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { MODEL_READS } from "../assistant/steps";
import schema from "../schema";

type Request = { url: URL };
let requests: Request[] = [];
/** The requests that read papers: one that only counts a search asks for a single work. */
const reads = () => requests.filter((request) => request.url.searchParams.get("per-page") !== "1");
/** OpenAlex, answering a page with as many works as it's asked for, of a search that has 57. */
const openAlex = vi.fn(async (input: string | URL) => {
  const url = new URL(String(input));
  requests.push({ url });
  if (url.pathname.includes("/autocomplete/")) {
    const author = url.pathname.endsWith("/authors");
    return new Response(JSON.stringify({ results: [{ id: `https://openalex.org/${author ? "A5023888391" : "F4320332161"}`, display_name: author ? "Jane Smith" : "Wellcome Trust", hint: author ? "University of Nairobi, Kenya" : "United Kingdom" }] }), { status: 200 });
  }
  // A count by group: OpenAlex returns the groups largest first, an entity by the address of its record.
  const by = url.searchParams.get("group_by");
  if (by) {
    const groups =
      by === "publication_year"
        ? [["2023", "2023", 30], ["2024", "2024", 22], ["2022", "2022", 5]]
        : by === "authorships.author.id"
          ? [["https://openalex.org/A1", "Ada Okafor", 9], ["https://openalex.org/A2", "Ben Mwangi", 4]]
          : [["https://openalex.org/languages/en", "English", 50], ["https://openalex.org/languages/fr", "French", 7]];
    return new Response(JSON.stringify({ meta: { count: 57 }, group_by: groups.map(([key, name, count]) => ({ key, key_display_name: name, count })) }), { status: 200 });
  }
  const one = url.pathname.match(/\/works\/(?:https:\/\/doi\.org\/)?(.+)$/)?.[1];
  if (one) {
    if (one === "W404") return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(work(7, "y".repeat(40))), { status: 200 });
  }
  const [page, size] = [url.searchParams.has("cursor") ? 1 : Number(url.searchParams.get("page")), Number(url.searchParams.get("per-page"))];
  const start = (page - 1) * size;
  // A search for "verbose" finds papers whose every text runs long.
  const long = decodeURIComponent(url.search).includes("verbose") ? "x".repeat(900) : "";
  const results = Array.from({ length: Math.max(0, Math.min(size, 57 - start)) }, (_, i) => work(start + i + 1, long));
  return new Response(JSON.stringify({ meta: { count: 57 }, results }), { status: 200 });
});

/** A work as OpenAlex returns one. */
const work = (number: number, long: string) => ({
  id: `https://openalex.org/W${number}`,
  display_name: `Paper ${number}${long}`,
  doi: `https://doi.org/10.1234/paper.${number}`,
  type: "article",
  language: "en",
  open_access: { is_oa: true, oa_url: `https://example.org/paper-${number}.pdf` },
  funders: [{ id: "https://openalex.org/F4320332161", display_name: "Wellcome Trust" }],
  publication_year: 2020,
  cited_by_count: 12,
  abstract_inverted_index: Object.fromEntries(Array.from({ length: 120 }, (_, word) => [`word${word}`, [word]])),
  // OpenAlex has no record for the third author: a paper names them, and that's all.
  authorships: ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Edsger Dijkstra"].map((name, at) => ({
    author: { ...(at === 2 ? {} : { id: `https://openalex.org/A${at + 1}` }), display_name: name + long },
    institutions: at < 2 ? [{ display_name: "University of Nairobi", country_code: "KE" }] : [{ display_name: "MIT", country_code: "US" }],
  })),
  primary_location: { source: { display_name: `A journal${long}` } },
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
  const { create, restore, remove, results } = api.research.searches;
  /** An edit as the tool takes it: the settings that change, each by name. */
  const update = ({ id, ...settings }: { id: string } & Record<string, unknown>) =>
    alice.mutation(api.research.searches.update, { id, changes: Object.entries(settings).map(([setting, value]) => ({ setting, value })) as FunctionArgs<typeof api.research.searches.update>["changes"] });
  const search = (id: string) => alice.query(api.research.records.getSearch, { accountId: "alice", id });
  /** What the results page writes as a search is read: its result count and the page last opened. */
  const change = (command: FunctionArgs<typeof api.research.records.change>["command"]) => alice.mutation(api.research.records.change, { accountId: "alice", requestId: `change-${Math.random()}`, command });
  const opened = (id: string, count = 57, page = 2) => change({ kind: "editSearch", id, edit: { kind: "patch", fields: { count, page }, clear: [] } });
  /** Lets the count that follows a new or changed search finish, so what comes next finds the search settled. */
  const counted = async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await t.finishInProgressScheduledFunctions();
  };
  const make = async (args: FunctionArgs<typeof create>) => {
    const made = await alice.mutation(create, args);
    await counted();
    return made;
  };
  const edit = async (args: Parameters<typeof update>[0]) => {
    const changed = await update(args);
    await counted();
    return changed;
  };
  return { t, alice, bob: t.withIdentity({ subject: "bob" }), make, edit, create, update, restore, remove, results, search, opened, change };
}

describe("the assistant's search tools", () => {
  it("make a search from plain settings, and take it back only while nothing has been done with it", async () => {
    const { t, alice, make, edit, create, remove, search, opened } = await setup();
    const made = await make({ query: " tutoring AND \"primary school\" ", fromYear: 2015, toYear: 2024, openAccessOnly: true, sort: "most_cited" });
    // It's counted as it's made, so its history says how many results it has before anyone opens it.
    expect(await search(made.id)).toMatchObject({
      query: 'tutoring AND "primary school"', field: "title_and_abstract", yearRange: [2015, 2024], isYearRangeEnabled: true, filterType: "year", openAccessOnly: true, sortBy: "cited_by_count:desc", queryHistoryCount: 1, count: 57,
    });
    expect(made.undo).toMatchObject({ path: "research/searches:remove", args: { id: made.id } });
    // Counting it, or opening it, isn't work done with it: it can still be taken back.
    await opened(made.id);
    await alice.mutation(remove, made.undo!.args);
    expect(await search(made.id)).toBeNull();

    // One whose filters were changed since stays.
    const kept = await make({ query: "tutoring" });
    await edit({ id: kept.id, reviewsOnly: true });
    await expect(alice.mutation(remove, kept.undo!.args)).rejects.toThrow(/changed since/);
    // Naming the revision it's at now doesn't pass it off as untouched.
    await expect(alice.mutation(remove, { id: kept.id, expect: { ...kept.undo!.args.expect, revision: await t.run(async (ctx) => (await ctx.db.query("searches").collect()).find((row) => row.localId === kept.id)!.revision) } })).rejects.toThrow(/changed since/);
    expect(await search(kept.id)).not.toBeNull();
    // Nothing to search by: no query, and no filter that narrows it.
    await expect(alice.mutation(create, { query: "  ", sort: "newest" })).rejects.toThrow(/needs a query, or a filter/);
    await expect(alice.mutation(create, { query: "tutoring", fromYear: 2020.5 })).rejects.toThrow(/whole number/);
    await expect(alice.mutation(create, { query: "tutoring", minCitations: -1 })).rejects.toThrow(/whole number/);
  });

  it("change a search's query and filters together, with one undo that puts both back", async () => {
    const { alice, make, edit, update, restore, search, opened } = await setup();
    const { id } = await make({ query: "tutoring", fromYear: 2010, minCitations: 5 });
    // The person has it open, on its second page.
    await opened(id);
    const changed = await edit({ id, query: "tutoring AND randomized", field: "title", toYear: 2020, withAbstractOnly: true, minCitations: null });
    // The changed search's results start from their first page.
    expect(await search(id)).toMatchObject({ query: "tutoring AND randomized", field: "title", yearRange: [2010, 2020], hasAbstract: true, queryHistoryCount: 2, page: 1 });
    expect((await search(id))!.minCitations).toBeUndefined();
    // Made, counted and opened are its first three revisions; the new query and the new filters the next two.
    expect(changed.undo).toEqual({ path: "research/searches:restore", args: { id, revision: 3, expect: 5 } });

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
    await edit({ id, reviewsOnly: true });
    await expect(alice.mutation(restore, changed.undo!.args)).rejects.toThrow(/changed since/);
    expect((await update({ id, reviewsOnly: true })).undo).toBeUndefined();
    // Both years taken off: the year filter goes.
    await edit({ id, fromYear: null, toYear: null });
    expect(await search(id)).toMatchObject({ isYearRangeEnabled: false });
    await expect(update({ id, fromYear: 2021, toYear: 2020 })).rejects.toThrow(/first year is after/);
    // A search can lose its query while a filter still narrows it, and not otherwise.
    await expect(update({ id, query: "   ", reviewsOnly: false, withAbstractOnly: false })).rejects.toThrow(/needs a query, or a filter/);
    expect((await search(id))!.query).toBe("tutoring AND randomized");
    await edit({ id, query: "", openAccessOnly: true });
    expect(await search(id)).toMatchObject({ query: "", openAccessOnly: true });
  });

  it("read a page of a search's results, ten papers at a time, where the person sees them, with how many it has in all", async () => {
    const { alice, bob, make, results, change } = await setup();
    const { id } = await make({ query: "tutoring" });
    const page = await alice.action(results, { id, page: 6 });
    expect(page).toMatchObject({ total: 57, page: 6, pages: 6 });
    expect(page.papers.map((paper) => paper.id)).toEqual(Array.from({ length: 7 }, (_, i) => `https://openalex.org/W${51 + i}`));
    // Its first authors come with their IDs, which the `authors` filter takes.
    expect(page.papers[0]).toMatchObject({ title: "Paper 51", authors: [{ name: "Ada Lovelace", id: "A1" }, { name: "Alan Turing", id: "A2" }, { name: "Grace Hopper" }], moreAuthors: 1, year: 2020, venue: "A journal", citations: 12 });
    // An abstract is cut, so ten papers stay short enough for the model to read at once.
    expect(page.papers[0].abstract!.length).toBeLessThanOrEqual(601);
    expect(page.papers[0]).toMatchObject({ countries: ["KE", "US"], type: "article", doi: "10.1234/paper.51", openAccess: true });
    expect(JSON.stringify(await alice.action(results, { id })).length).toBeLessThan(MODEL_READS);
    // By relevance, a page is one request for only its papers.
    expect(reads()).toHaveLength(2);
    expect(Object.fromEntries(reads()[0].url.searchParams)).toMatchObject({ page: "6", "per-page": "10", sort: "relevance_score:desc" });
    expect(decodeURIComponent(reads()[0].url.search)).toContain("tutoring");

    // Under any other sort OpenAlex orders numbered pages differently from the results page, so the page is read as the results page reads it: from the start.
    const byDate = await make({ query: "tutoring", sort: "newest" });
    requests = [];
    expect((await alice.action(results, { id: byDate.id, page: 6 })).papers.map((paper) => paper.id)).toEqual(page.papers.map((paper) => paper.id));
    expect(Object.fromEntries(reads()[0].url.searchParams)).toMatchObject({ cursor: "*", "per-page": "200", sort: "publication_date:desc" });

    // Someone else's search isn't read.
    await expect(bob.action(results, { id })).rejects.toThrow(/not found/i);
    await expect(alice.action(results, { id, page: 0 })).rejects.toThrow(/count from 1/);
    // A page OpenAlex wouldn't answer, or one that would take many requests to reach, isn't asked for.
    requests = [];
    await expect(alice.action(results, { id, page: 1_001 })).rejects.toThrow(/up to page 1,000/);
    await expect(alice.action(results, { id: byDate.id, page: 201 })).rejects.toThrow(/up to page 200/);
    expect(requests).toHaveLength(0);

    // Ten papers whose every text runs long are still read whole.
    const verbose = await make({ query: "verbose" });
    const wordy = await alice.action(results, { id: verbose.id });
    expect(wordy.papers).toHaveLength(10);
    expect(JSON.stringify(wordy).length).toBeLessThan(MODEL_READS);
    // An author with an ID is filtered by it, so their name is cut. One without is filtered by name: a long one comes as its leading whole words, which still find them.
    expect(wordy.papers[0].authors!.map((author) => author.name)).toEqual([expect.stringMatching(/^Ada Lovelacex+…$/), expect.stringMatching(/^Alan Turingx+…$/), "Grace"]);

    // A search that keeps only rated papers returns those, as its page shows them.
    await change({ kind: "editSearch", id, edit: { kind: "patch", fields: { onlyRatedPapers: true, ratingRange: [4, 5] }, clear: [] } });
    await change({ kind: "rating", paperId: "https://openalex.org/W2", rating: 5 });
    await change({ kind: "rating", paperId: "https://openalex.org/W3", rating: 2 });
    expect((await alice.action(results, { id })).papers.map((paper) => paper.id)).toEqual(["https://openalex.org/W2"]);
  });

  it("set the page's own filters: what a paper is about, where its authors work, its type, language and goals, and exact days", async () => {
    const { alice, make, edit, update, restore, results, search } = await setup();
    const { id } = await make({ query: "tutoring", about: ["Africa"], authorsIn: ["ke", "Western Africa"], types: ["article"], languages: ["en", "fr"], institutionTypes: ["education"], sdgs: [4], fromDate: "2025-10-04" });
    // They're kept as the page keeps them, so the page shows them as its own.
    expect(await search(id)).toMatchObject({
      selectedCountryFocus: ["africa"], selectedRegions: ["KE", "western_africa"], workTypes: ["article"], workLanguages: ["en", "fr"], institutionTypes: ["education"], sdgs: ["4"], filterType: "date", dateRange: { from: "2025-10-04" },
    });
    // And the search OpenAlex is asked is the page's own, with each of them in it.
    requests = [];
    await alice.action(results, { id });
    const asked = decodeURIComponent(reads()[0].url.search);
    for (const part of ['"Kenya"', '"Nigeria"', "from_publication_date:2025-10-04", "authorships.countries:KE|BJ|", "authorships.institutions.type:education", "sustainable_development_goals.id:https://metadata.un.org/sdg/4", "type:article", "language:en|fr"]) expect(asked).toContain(part);

    // A value a filter doesn't take is refused with the ones it does.
    await expect(update({ id, about: ["Atlantis"] })).rejects.toThrow(/western_africa/);
    await expect(update({ id, types: ["poem"] })).rejects.toThrow(/book-chapter/);
    await expect(update({ id, authorsIn: ["world"] })).rejects.toThrow(/at most 100 countries/);
    await expect(update({ id, sdgs: [18] })).rejects.toThrow(/1 to 17/);
    await expect(update({ id, fromYear: 2020, fromDate: "2025-01-01" })).rejects.toThrow(/not both/);
    await expect(update({ id, fromDate: "last year" })).rejects.toThrow(/YYYY-MM-DD/);
    // A day the calendar doesn't have would leave a search its page can't open.
    await expect(update({ id, fromDate: "2025-02-30" })).rejects.toThrow(/the calendar has/);
    await expect(update({ id, fromDate: "2025-13-01" })).rejects.toThrow(/the calendar has/);
    // Taking a filter off that's already off changes nothing: no revision, no undo.
    expect(await update({ id, funders: null, citationsOf: null, openAccessOnly: false })).toEqual({});
    // Years in place of days, in one call.
    await edit({ id, fromDate: null, toDate: null, fromYear: 2020, toYear: 2024 });
    expect(await search(id)).toMatchObject({ filterType: "year", yearRange: [2020, 2024] });
    expect((await search(id))!.dateRange).toBeUndefined();
    // And days in place of years, with one year's end left out: the years go whole, not half.
    await edit({ id, fromYear: null, fromDate: "2025-10-04" });
    expect(await search(id)).toMatchObject({ filterType: "date", dateRange: { from: "2025-10-04" }, isYearRangeEnabled: false });
    expect((await search(id))!.yearRange).toBeUndefined();

    // null takes a filter off, and the change is undone like any other. A rating to keep papers by keeps
    // rated papers alone, without being told to: the page reads the range only then.
    const changed = await edit({ id, about: null, sdgs: null, minRating: 4 });
    expect(await search(id)).toMatchObject({ selectedCountryFocus: [], sdgs: [], ratingRange: [4, 5], onlyRatedPapers: true });
    await alice.mutation(restore, changed.undo!.args);
    expect(await search(id)).toMatchObject({ selectedCountryFocus: ["africa"], sdgs: ["4"] });
    expect((await search(id))!.onlyRatedPapers).toBeUndefined();
  });

  it("edit a search by naming what changes, so a model that fills in every argument takes no filter off", async () => {
    const { make, edit, update, search } = await setup();
    const { id } = await make({ query: "tutoring", about: ["africa"], fromDate: "2025-10-04", toDate: "2026-10-04", reviewsOnly: true, sort: "most_cited" });
    // One change, by name: everything else the search had stays.
    await edit({ id, openAccessOnly: true });
    expect(await search(id)).toMatchObject({ query: "tutoring", openAccessOnly: true, selectedCountryFocus: ["africa"], dateRange: { from: "2025-10-04", to: "2026-10-04" }, reviewFilter: true, sortBy: "cited_by_count:desc" });
    // Two slips are read as what they mean: one value where a list goes, and null for a switch.
    await edit({ id, about: "southern_asia", reviewsOnly: null });
    expect(await search(id)).toMatchObject({ selectedCountryFocus: ["southern_asia"], reviewFilter: false, openAccessOnly: true });
    // A value a setting doesn't take is refused with what it does.
    await expect(update({ id, sort: "best" })).rejects.toThrow(/`sort` takes .*relevance.* or .*most_cited.* or .*newest.* or .*oldest/);
    await expect(update({ id, minCitations: "many" })).rejects.toThrow(/`minCitations` takes a number or null/);
    await expect(update({ id, query: 7 })).rejects.toThrow(/`query` takes text/);
  });

  it("filter by an author, a funder, a research area or a paper, by the IDs a result or a lookup gives", async () => {
    const { alice, make, update, results, search } = await setup();
    const find = api.research.lookup.find;
    // An author, by name: who they are and where they work, with the ID to filter by.
    requests = [];
    expect(await alice.action(find, { kind: "author", text: "Jane Smith" })).toEqual({ matches: [{ id: "A5023888391", name: "Jane Smith", detail: "University of Nairobi, Kenya" }] });
    expect((await alice.action(find, { kind: "funder", text: "Wellcome" })).matches[0]).toMatchObject({ id: "F4320332161", name: "Wellcome Trust" });
    expect(requests.map((request) => request.url.pathname.split("/").slice(-2).join("/"))).toEqual(["autocomplete/authors", "autocomplete/funders"]);
    // A research area comes from the app's own catalog, with what it sits under, and asks OpenAlex nothing.
    const areas = await alice.action(find, { kind: "researchArea", text: "education" });
    expect(areas.matches.length).toBeGreaterThan(0);
    for (const area of areas.matches) expect(area).toMatchObject({ id: expect.stringMatching(/^(?:(?:domains|fields|subfields)\/\d+|T\d+)$/), name: expect.stringMatching(/education/i), detail: expect.any(String) });
    expect(requests).toHaveLength(2);

    const { id } = await make({ query: "tutoring", authors: ["A5023888391", "https://openalex.org/authors/A1", "UNESCO"], funders: ["https://openalex.org/F4320332161"], researchAreas: [areas.matches[0].id], citationsOf: "https://openalex.org/W2741809807" });
    expect(await search(id)).toMatchObject({ authors: ["A5023888391", "A1", "UNESCO"], funders: ["F4320332161"], researchAreas: [areas.matches[0].id], citesItemId: "W2741809807" });
    requests = [];
    await alice.action(results, { id });
    const asked = decodeURIComponent(reads()[0].url.search);
    for (const part of ["authorships.author.id:A5023888391|A1", 'raw_author_name.search:"UNESCO"', "funders.id:F4320332161", "cites:https://openalex.org/W2741809807", "topics."]) expect(asked).toContain(part);

    // What isn't an ID says where to find one.
    await expect(update({ id, funders: ["Wellcome Trust"] })).rejects.toThrow(/research\/lookup:find/);
    await expect(update({ id, researchAreas: ["Education"] })).rejects.toThrow(/research\/lookup:find/);
    await expect(update({ id, relatedTo: "that paper" })).rejects.toThrow(/one paper's ID/);
    await expect(alice.action(find, { kind: "author", text: " " })).rejects.toThrow(/name to look for/);
  });

  it("look papers up without saving anything: by a query, by a filter alone, and one paper whole", async () => {
    const { t, alice, make, search } = await setup();
    const { search: find, get } = api.research.papers;
    const rows = () => t.run(async (ctx) => (await ctx.db.query("searches").take(10)).length);
    // The papers that cite one paper, with no query: nothing is saved, and the request is the filter alone.
    requests = [];
    const citing = await alice.action(find, { citationsOf: "W2741809807", authorsIn: ["KE"] });
    expect(citing).toMatchObject({ total: 57, page: 1, papers: expect.arrayContaining([expect.objectContaining({ id: "https://openalex.org/W1", countries: ["KE", "US"], openAccess: true })]) });
    expect(citing.papers).toHaveLength(10);
    expect(await rows()).toBe(0);
    const asked = decodeURIComponent(reads()[0].url.search);
    expect(asked).toContain("cites:https://openalex.org/W2741809807");
    expect(reads()[0].url.searchParams.get("search")).toBeNull();
    // A paper's own reference list is the other direction.
    requests = [];
    await alice.action(find, { query: "tutoring", referencesOf: "W2741809807", page: 2 });
    expect(decodeURIComponent(reads()[0].url.search)).toContain("cited_by:https://openalex.org/W2741809807");
    expect(reads()[0].url.searchParams.get("page")).toBe("2");
    // A model that fills in every argument sends null for what it doesn't mean: that reads as left out.
    expect((await alice.action(find, { query: "tutoring", page: null, fromYear: null, about: null, citationsOf: null })).page).toBe(1);
    await expect(alice.action(find, {})).rejects.toThrow(/needs a query, or a filter/);
    // A citation minimum of none narrows nothing; papers with an abstract do.
    await expect(alice.action(find, { minCitations: 0, sort: "newest" })).rejects.toThrow(/needs a query, or a filter/);
    expect((await alice.action(find, { withAbstractOnly: true })).total).toBe(57);

    // One paper, whole: every author with where they work, and all of its abstract.
    const paper = await alice.action(get, { id: "https://openalex.org/W7" });
    expect(paper).toMatchObject({ id: "https://openalex.org/W7", doi: "10.1234/paper.7", type: "article", language: "en", openAccess: true, link: "https://example.org/paper-7.pdf", year: 2020, citations: 12, funders: [{ name: "Wellcome Trust", id: "F4320332161" }] });
    expect(paper.authors[0]).toEqual({ name: `Ada Lovelace${"y".repeat(40)}`, id: "A1", institutions: ["University of Nairobi (KE)"] });
    expect(paper.abstract!.split(" ")).toHaveLength(120);
    // By its DOI too, and one OpenAlex doesn't have says so.
    requests = [];
    await alice.action(get, { id: "doi:10.1234/paper.7" });
    expect(requests[0].url.pathname).toContain("/works/https://doi.org/10.1234/paper.7");
    await expect(alice.action(get, { id: "W404" })).rejects.toThrow(/no paper by that ID/);
    await expect(alice.action(get, { id: "the third one" })).rejects.toThrow(/its ID, such as W2741809807, or its DOI/);
    // A DOI that would send the request somewhere else isn't one.
    requests = [];
    for (const id of ["10.1234/../../../authors/A1", "10.1234/x?select=id", "10.1234/x#y"]) await expect(alice.action(get, { id })).rejects.toThrow(/its ID, such as W2741809807, or its DOI/);
    expect(requests).toEqual([]);

    // A saved search is deleted for good, with nothing kept to bring it back.
    const { id } = await make({ query: "tutoring" });
    expect(await alice.mutation(api.research.searches.deleteSearch, { id })).toBeNull();
    expect(await search(id)).toBeNull();
    await expect(alice.mutation(api.research.searches.deleteSearch, { id })).rejects.toThrow(/not found/i);
  });

  it("count papers and how they divide, in one request, and take the names people use for parts of the world", async () => {
    const { alice, make, search } = await setup();
    const { count } = api.research.papers;
    // How many, and nothing else. null is what a model that fills in every argument sends for what it doesn't mean.
    expect(await alice.action(count, { query: "tutoring", by: null, fromYear: null })).toEqual({ total: 57 });
    // By year, in order, whatever order OpenAlex counted them in.
    requests = [];
    expect(await alice.action(count, { query: "tutoring", by: "year", about: ["sub_saharan_africa"] })).toEqual({ total: 57, groups: [{ name: "2022", count: 5 }, { name: "2023", count: 30 }, { name: "2024", count: 22 }] });
    expect(requests).toHaveLength(1);
    expect(requests[0].url.searchParams.get("group_by")).toBe("publication_year");
    // By author, largest first, each with the ID the `authors` filter takes; by language, with none.
    expect((await alice.action(count, { query: "tutoring", by: "author" })).groups).toEqual([{ name: "Ada Okafor", count: 9, id: "A1" }, { name: "Ben Mwangi", count: 4, id: "A2" }]);
    expect((await alice.action(count, { query: "tutoring", by: "language" })).groups).toEqual([{ name: "English", count: 50 }, { name: "French", count: 7 }]);
    // Which papers a person rated isn't OpenAlex's to count.
    await expect(alice.action(count, { query: "tutoring", ratedOnly: true, by: "year" })).rejects.toThrow(/can't be counted/);

    // Sub-Saharan Africa and Latin America are the page's own regions put together, each once.
    const { id } = await make({ query: "tutoring", about: ["Sub-Saharan Africa", "latin_america", "eastern_africa"], authorsIn: ["latin america and the caribbean"] });
    expect(await search(id)).toMatchObject({
      selectedCountryFocus: ["eastern_africa", "middle_africa", "southern_africa", "western_africa", "caribbean", "central_america", "south_america"],
      selectedRegions: ["caribbean", "central_america", "south_america"],
    });
  });

  it("count a search again when its query or filters change, and record a count as whoever's read made it", async () => {
    const { t, alice, make, edit, results, search } = await setup();
    const { id } = await make({ query: "tutoring" });
    // The count it holds was the old query's: the page isn't open to read the new one.
    openAlex.mockImplementationOnce(async () => new Response(JSON.stringify({ meta: { count: 9 }, results: [] }), { status: 200 }));
    await edit({ id, query: "tutoring AND randomized" });
    expect((await search(id))!.count).toBe(9);
    // Read by the person, a new count is theirs in the search's history, not the assistant's.
    await alice.action(results, { id });
    expect((await search(id))!.count).toBe(57);
    const authors = await t.run(async (ctx) => (await ctx.db.query("searchRevisions").collect()).map((row) => row.author));
    expect(new Set(authors)).toEqual(new Set(["user"]));
  });
});
