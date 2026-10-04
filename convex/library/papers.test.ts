import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

let requests: URL[] = [];
/** OpenAlex, answering for one work as its API does: the abstract as an index of words, and nothing for a work it doesn't have. */
const openAlex = vi.fn(async (input: string | URL) => {
  const url = new URL(String(input));
  requests.push(url);
  const id = url.pathname.split("/").at(-1)!;
  if (id === "W404") return new Response("{}", { status: 404 });
  return new Response(
    JSON.stringify({
      id: `https://openalex.org/${id}`,
      display_name: "Tutoring at scale",
      doi: "https://doi.org/10.1234/tutoring",
      publication_year: 2021,
      abstract_inverted_index: { Tutoring: [0], works: [1] },
      authorships: [{ author: { display_name: "Ada Okafor" } }, { author: { display_name: "Ben Mwangi" } }],
      open_access: { is_oa: true, oa_status: "gold" },
      cited_by_count: 40,
      primary_location: { source: { display_name: "Journal of Trials" } },
      type: "article",
    }),
    { status: 200 },
  );
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

describe("saving a paper by its ID", () => {
  it("reads the paper from OpenAlex and saves it as the results page would, under one ID however it's written", async () => {
    const t = convexTest(schema);
    const userId = await t.run(async (ctx) => ctx.db.insert("users", { libraryItemCount: 0, clerkId: "ada", email: "ada@example.com", state: "active", createdAt: 1, updatedAt: 1 }));
    const ada = t.withIdentity({ subject: "ada" });
    const { save } = api.library.papers;
    const items = () => t.run(async (ctx) => ctx.db.query("libraryItems").take(10));

    // By the bare ID, with nothing else about the paper: the record is read here.
    const saved = await ada.action(save, { id: "W7", rating: null, collectionId: null });
    expect(saved).toMatchObject({ title: "Tutoring at scale", undo: { path: "library/mutations:removeFromLibrary", args: { openalexId: "https://openalex.org/W7" } } });
    expect(requests).toHaveLength(1);
    expect(requests[0].pathname).toMatch(/\/works\/W7$/);
    const [item] = await items();
    // What the page saves from a results card: the trimmed fields, the abstract as text, and the whole record for the card.
    expect(item).toMatchObject({ userId, openalexId: "https://openalex.org/W7", title: "Tutoring at scale", authors: "Ada Okafor, Ben Mwangi", doi: "https://doi.org/10.1234/tutoring", abstract: "Tutoring works", publicationYear: 2021, journal: "Journal of Trials", citedByCount: 40, workType: "article", isOpenAccess: true, oaStatus: "gold" });
    expect(item.rating).toBeUndefined();
    expect(JSON.parse(item.paperData!)).toMatchObject({ id: "https://openalex.org/W7", abstract: "Tutoring works", authorships: [{ author: { display_name: "Ada Okafor" } }, { author: { display_name: "Ben Mwangi" } }] });
    expect(JSON.parse(item.paperData!).abstract_inverted_index).toBeUndefined();

    // The same paper by its whole ID is the same saved paper: rated, with an undo that puts the rating back.
    const rated = await ada.action(save, { id: "https://openalex.org/W7", rating: 4 });
    expect(rated).toMatchObject({ libraryItemId: saved.libraryItemId, undo: { path: "library/mutations:setLibraryRating", args: { rating: null } } });
    expect(await items()).toHaveLength(1);
    expect((await items())[0].rating).toBe(4);
    // And the reads that take a paper's ID find it either way.
    expect(await ada.query(api.library.queries.savedPaper, { openalexId: "W7" })).toMatchObject({ libraryItemId: saved.libraryItemId });

    // Into a collection: already saved, so what's undone is its place there.
    const collectionId = await t.run(async (ctx) => ctx.db.insert("collections", { userId, name: "Chapter 2", itemCount: 0, createdAt: 1, updatedAt: 1 }));
    const placed = await ada.action(save, { id: "W7", collectionId });
    expect(placed.undo).toMatchObject({ path: "library/mutations:setPaperInCollection", args: { collectionId, inCollection: false, paper: { openalexId: "https://openalex.org/W7" } } });
    expect((await items())[0].rating).toBe(4);
    expect(await t.run(async (ctx) => (await ctx.db.query("libraryItemCollections").take(5)).length)).toBe(1);
    // A new paper saved straight into a collection is undone by removing it, which takes it out of the collection too.
    expect((await ada.action(save, { id: "W8", collectionId })).undo).toMatchObject({ path: "library/mutations:removeFromLibrary" });
    expect(await t.run(async (ctx) => (await ctx.db.query("libraryItemCollections").take(5)).length)).toBe(2);

    // What isn't a paper's ID, a paper OpenAlex doesn't have, and a rating off the scale are refused, and save nothing.
    await expect(ada.action(save, { id: "the third one" })).rejects.toThrow(/saved by its ID/);
    await expect(ada.action(save, { id: "W404" })).rejects.toThrow(/no paper by that ID/);
    await expect(ada.action(save, { id: "W9", rating: 9 })).rejects.toThrow(/0 to 5/);
    expect(await items()).toHaveLength(2);
  });
});
