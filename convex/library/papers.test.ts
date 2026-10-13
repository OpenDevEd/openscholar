import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { madeBy } from "../workspaces/actor.test-support";
import { personalWorkspaceOf } from "../workspaces/personal";

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
  it("puts the paper in a collection as it saves it, and one undo takes back what the call did", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => ctx.db.insert("users", { clerkId: "ada", email: "ada@example.com", state: "active", createdAt: 1, updatedAt: 1 }));
    const ada = t.withIdentity({ subject: "ada" });
    const { save } = api.library.papers;
    const { id: collectionId } = await ada.mutation(api.library.collections.createCollection, { name: "Reading" });
    const { id: other } = await ada.mutation(api.library.collections.createCollection, { name: "Elsewhere" });
    const held = () => t.run(async (ctx) => ({ papers: (await ctx.db.query("libraryItems").take(10)).length, places: (await ctx.db.query("libraryItemCollections").take(10)).map((row) => row.collectionId) }));

    // One call saves it and puts it there. Its undo removes the paper, place and all.
    const saved = await ada.action(save, { id: "W7", collectionId });
    expect(await held()).toEqual({ papers: 1, places: [collectionId] });
    expect(saved.undo).toMatchObject({ path: "library/mutations:removeFromLibrary", args: { expect: { collectionId } } });
    await ada.mutation(api.library.mutations.removeFromLibrary, saved.undo!.args as never);
    expect(await held()).toEqual({ papers: 0, places: [] });

    // A paper that was saved already only gains its place, and the undo takes that place alone.
    await ada.action(save, { id: "W7" });
    const placed = await ada.action(save, { id: "W7", collectionId });
    expect(placed.undo).toMatchObject({ path: "library/mutations:setPaperInCollection", args: { collectionId, inCollection: false } });
    await ada.mutation(api.library.mutations.setPaperInCollection, placed.undo!.args as never);
    expect(await held()).toEqual({ papers: 1, places: [] });

    // Taken out of the collection and put back since, its place is a later change, which the save's undo leaves alone.
    await ada.mutation(api.library.mutations.removeFromLibrary, { paper: "W7" });
    const first = await ada.action(save, { id: "W7", collectionId });
    await ada.mutation(api.library.mutations.setPaperInCollection, { paper: { paper: "https://openalex.org/W7" }, collectionId, inCollection: false });
    // A place is told apart by when it was given, to the millisecond.
    await new Promise((resolve) => setTimeout(resolve, 3));
    await ada.mutation(api.library.mutations.setPaperInCollection, { paper: { paper: "https://openalex.org/W7" }, collectionId, inCollection: true });
    await expect(ada.mutation(api.library.mutations.removeFromLibrary, first.undo!.args as never)).rejects.toThrow(/changed since/);
    expect(await held()).toEqual({ papers: 1, places: [collectionId] });

    // A saved paper given a new rating and a collection in one call would be two changes with one undo: nothing is written.
    await expect(ada.action(save, { id: "W7", rating: 5, collectionId: other })).rejects.toMatchObject({ data: { code: "VALIDATION_ERROR" } });
    expect(await held()).toEqual({ papers: 1, places: [collectionId] });
    // A paper the person rated on a search card is saved with that rating, and its save still has an undo: removing the paper leaves the rating.
    const userId = (await t.run(async (ctx) => ctx.db.query("users").first()))!._id;
    await t.run(async (ctx) => ctx.db.insert("ratings", { userId, paperId: "https://openalex.org/W8", rating: 3 }));
    expect(await ada.action(save, { id: "W8", collectionId })).toHaveProperty("undo");
    expect(await t.run(async (ctx) => (await ctx.db.query("libraryItems").take(10)).find((row) => row.openalexId === "https://openalex.org/W8")?.rating)).toBe(3);

    // Taken out of the collection since and left out, the paper is no longer as the save left it either.
    await ada.mutation(api.library.mutations.removeFromLibrary, { paper: "W7" });
    const taken = await ada.action(save, { id: "W7", collectionId });
    await ada.mutation(api.library.mutations.setPaperInCollection, { paper: { paper: "https://openalex.org/W7" }, collectionId, inCollection: false });
    await expect(ada.mutation(api.library.mutations.removeFromLibrary, taken.undo!.args as never)).rejects.toThrow(/changed since/);

    // Put somewhere else since it was saved, the paper has changed: the save's undo leaves it.
    await ada.mutation(api.library.mutations.removeFromLibrary, { paper: "W7" });
    const again = await ada.action(save, { id: "W7", collectionId });
    await ada.mutation(api.library.mutations.setPaperInCollection, { paper: { paper: "https://openalex.org/W7" }, collectionId: other, inCollection: true });
    await expect(ada.mutation(api.library.mutations.removeFromLibrary, again.undo!.args as never)).rejects.toThrow(/changed since/);
    // Both papers are still there: this one, and the one saved from a card.
    expect((await held()).papers).toBe(2);
  });

  it("reads the paper from OpenAlex and saves it as the results page would, under one ID however it's written", async () => {
    const t = convexTest(schema);
    const userId = await t.run(async (ctx) => ctx.db.insert("users", { clerkId: "ada", email: "ada@example.com", state: "active", createdAt: 1, updatedAt: 1 }));
    const ada = t.withIdentity({ subject: "ada" });
    const { save } = api.library.papers;
    const items = () => t.run(async (ctx) => ctx.db.query("libraryItems").take(10));

    // By the bare ID, with nothing else about the paper: the record is read here.
    const saved = await ada.action(save, { id: "W7", rating: null });
    expect(saved).toMatchObject({ title: "Tutoring at scale", undo: { path: "library/mutations:removeFromLibrary", args: { paper: "openalex:W7" } } });
    expect(requests).toHaveLength(1);
    expect(requests[0].pathname).toMatch(/\/works\/W7$/);
    const [item] = await items();
    // What the page saves from a results card: the trimmed fields, the abstract as text, and the whole record for the card.
    expect(item).toMatchObject({ createdBy: userId, openalexId: "https://openalex.org/W7", title: "Tutoring at scale", authors: ["Ada Okafor", "Ben Mwangi"], doi: "https://doi.org/10.1234/tutoring", abstract: "Tutoring works", publicationYear: 2021, journal: "Journal of Trials", citedByCount: 40, workType: "article", isOpenAccess: true, oaStatus: "gold" });
    expect(item.rating).toBeUndefined();
    expect(JSON.parse(item.paperData!)).toMatchObject({ id: "https://openalex.org/W7", abstract: "Tutoring works", authorships: [{ author: { display_name: "Ada Okafor" } }, { author: { display_name: "Ben Mwangi" } }] });
    expect(JSON.parse(item.paperData!).abstract_inverted_index).toBeUndefined();

    // The same paper by its whole ID, or by the key the library lists it under, is the same saved paper: rated, with an undo that puts the rating back.
    expect((await ada.action(save, { id: "openalex:W7" })).libraryItemId).toBe(saved.libraryItemId);
    const rated = await ada.action(save, { id: "https://openalex.org/W7", rating: 4 });
    expect(rated).toMatchObject({ libraryItemId: saved.libraryItemId, undo: { path: "library/mutations:setLibraryRating", args: { rating: null } } });
    expect(await items()).toHaveLength(1);
    expect((await items())[0].rating).toBe(4);
    // And the reads that take a paper's ID find it either way.
    expect(await ada.query(api.library.queries.savedPaper, { paper: "W7" })).toMatchObject({ libraryItemId: saved.libraryItemId });

    // Into a collection by the same bare ID, and a whole paper put in one under a bare ID is saved under the form the library keeps.
    const collectionId = await t.run(async (ctx) => ctx.db.insert("collections", { ...(await madeBy(ctx, userId)), name: "Chapter 2", sortName: ("Chapter 2").toLowerCase(), itemCount: 0, createdAt: 1, updatedAt: 1 }));
    const { setPaperInCollection, removeFromLibrary } = api.library.mutations;
    expect((await ada.mutation(setPaperInCollection, { paper: { paper: "W7" }, collectionId, inCollection: true })).undo).toMatchObject({ args: { collectionId, inCollection: false } });
    await ada.mutation(setPaperInCollection, { paper: { paper: "W8", title: "Another paper" }, collectionId, inCollection: true });
    expect((await items()).map((row) => row.openalexId).sort()).toEqual(["https://openalex.org/W7", "https://openalex.org/W8"]);
    expect(await t.run(async (ctx) => (await ctx.db.query("libraryItemCollections").take(5)).length)).toBe(2);

    // The assistant's own way in and out of a collection takes the paper's ID alone, and says to save a paper that isn't saved yet.
    const { collect } = api.library.papers;
    expect((await ada.mutation(collect, { id: "W7", collectionId, inCollection: false })).undo).toMatchObject({ path: "library/mutations:setPaperInCollection", args: { collectionId, inCollection: true } });
    expect(await t.run(async (ctx) => (await ctx.db.query("libraryItemCollections").take(5)).length)).toBe(1);
    await ada.mutation(collect, { id: "https://openalex.org/W7", collectionId, inCollection: true });
    expect(await t.run(async (ctx) => (await ctx.db.query("libraryItemCollections").take(5)).length)).toBe(2);
    await expect(ada.mutation(collect, { id: "W99", collectionId, inCollection: true })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });

    // A paper saved under its bare ID, before the library kept one form, is still found by it, and can still be removed.
    await t.run(async (ctx) => ctx.db.insert("libraryItems", { ...(await madeBy(ctx, userId)), openalexId: "W5", title: "Saved bare", searchableText: "Saved bare", savedAt: 1, updatedAt: 1 }));
    expect(await ada.query(api.library.queries.savedPaper, { paper: "W5" })).not.toBeNull();
    await ada.mutation(collect, { id: "W5", collectionId, inCollection: true });
    expect(await t.run(async (ctx) => (await ctx.db.query("libraryItemCollections").take(5)).length)).toBe(3);
    await ada.mutation(removeFromLibrary, { paper: "W5" });
    expect((await items()).some((row) => row.title === "Saved bare")).toBe(false);

    // A save into a collection a library follows asks the person first. The record's read takes a moment, so the write checks again: a collection
    // that came to be followed meanwhile is refused for the assistant unless the person said yes, and saved into for the person themselves.
    const workspaceId = await t.run((ctx) => personalWorkspaceOf(ctx, userId));
    await t.run(async (ctx) => {
      const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId, name: "Library", slug: "library", state: "active", createdByClerkUserId: "ada", updatedByClerkUserId: "ada", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("evidenceLibraryCollectionSources", { libraryId, collectionId, connectedByClerkUserId: "ada", connectedAt: 1 });
    });
    const intoFollowed = { userId, workspaceId, paper: { paper: "https://openalex.org/W6", title: "Into a followed collection" }, collectionId };
    await expect(t.mutation(internal.library.mutations.saveRead, { ...intoFollowed, author: "assistant" })).rejects.toThrow(/person's say first/);
    expect(await t.mutation(internal.library.mutations.saveRead, { ...intoFollowed, author: "assistant", approved: true })).toMatchObject({ title: "Into a followed collection" });
    await ada.mutation(removeFromLibrary, { paper: "W6" });
    expect(await t.mutation(internal.library.mutations.saveRead, { ...intoFollowed, author: "user" })).toMatchObject({ title: "Into a followed collection" });
    await ada.mutation(removeFromLibrary, { paper: "W6" });

    // The save the page uses takes a paper's whole record. From the assistant, the card's own record isn't kept: it made one up, and the library page couldn't read it.
    await t.mutation(internal.library.mutations.saveToLibraryForAssistant, { userId, paper: "W9", title: "Made up", paperData: JSON.stringify({ title: "No ID here" }) });
    const madeUp = (await items()).find((row) => row.title === "Made up")!;
    expect(madeUp).toMatchObject({ openalexId: "https://openalex.org/W9" });
    expect(madeUp.paperData).toBeUndefined();
    await ada.mutation(api.library.mutations.removeFromLibrary, { paper: "W9" });

    // What isn't a paper's ID, a paper OpenAlex doesn't have, and a rating off the scale are refused, and save nothing.
    await expect(ada.action(save, { id: "the third one" })).rejects.toThrow(/saved by its OpenAlex ID/);
    await expect(ada.action(save, { id: "W404" })).rejects.toThrow(/no paper by that ID/);
    await expect(ada.action(save, { id: "W9", rating: 9 })).rejects.toThrow(/0 to 5/);
    expect((await items()).map((row) => row.openalexId).sort()).toEqual(["https://openalex.org/W7", "https://openalex.org/W8"]);
  });
});
