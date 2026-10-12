// The assistant's reads of OpenAlex beyond papers (#323): an author, a research area, the
// names a saved search's filters hold by ID, a paper cited in a style, and the models a chat
// can run on. Each refuses what isn't an ID before it asks OpenAlex anything.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { CATALOG_REVISION } from "../../lib/topics/catalog";

let requests: URL[] = [];
const openAlex = vi.fn(async (input: string | URL) => {
  const url = new URL(String(input));
  requests.push(url);
  if (url.hostname === "doi.org") return new Response("", { status: 404 });
  if (url.pathname.endsWith("/authors/A5023888391")) {
    return Response.json({
      id: "https://openalex.org/A5023888391", display_name: "Jane Smith", orcid: "https://orcid.org/0000-0002-1825-0097", works_count: 84, cited_by_count: 2_310, summary_stats: { h_index: 21 },
      last_known_institutions: [{ id: "https://openalex.org/I1", display_name: "University of Nairobi", country_code: "KE" }],
      topics: [{ id: "https://openalex.org/T10001", display_name: "Geological and Geochemical Analysis", count: 12 }],
    });
  }
  if (url.pathname.endsWith("/authors/A404")) return new Response("{}", { status: 404 });
  if (url.pathname.endsWith("/works/W7")) {
    return Response.json({ id: "https://openalex.org/W7", title: "Tutoring at scale", type: "article", type_crossref: "journal-article", publication_year: 2020, authorships: [{ author: { display_name: "Ada Okafor" } }], primary_location: { source: { display_name: "Journal of Learning" } } });
  }
  // Names by ID: one request a kind, the IDs in its filter.
  const ids = (url.searchParams.get("filter") ?? "").replace("openalex_id:", "").split("|");
  return Response.json({ results: ids.filter((id) => id !== "F404").map((id) => ({ id: `https://openalex.org/${id}`, display_name: `Name of ${id}` })) });
});

beforeEach(() => {
  requests = [];
  vi.stubEnv("OPENALEX_API_KEY", "platform-key");
  vi.stubEnv("OPENALEX_CONTACT_EMAIL", "contact@example.test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubGlobal("fetch", openAlex);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { clerkId: "alice", email: "alice@example.com", state: "active", createdAt: 1, updatedAt: 1 });
  });
  return { t, alice: t.withIdentity({ subject: "alice" }) };
}

describe("the assistant's reads of OpenAlex", () => {
  it("read an author by their ID, with where they work and what they publish on", async () => {
    const { alice } = await setup();
    expect(await alice.action(api.research.authors.get, { id: "https://openalex.org/a5023888391" })).toEqual({
      id: "A5023888391", name: "Jane Smith", orcid: "0000-0002-1825-0097", papers: 84, citations: 2_310, hIndex: 21,
      institutions: [{ id: "I1", name: "University of Nairobi", country: "KE" }],
      areas: [{ id: "T10001", name: "Geological and Geochemical Analysis", papers: 12 }],
      link: "[Jane Smith](https://openalex.org/A5023888391)",
    });
    await expect(alice.action(api.research.authors.get, { id: "A404" })).rejects.toThrow(/no author by that ID/);
    requests = [];
    await expect(alice.action(api.research.authors.get, { id: "../works/W1" })).rejects.toThrow(/OpenAlex ID, such as A5023888391/);
    expect(requests).toEqual([]);
  });

  it("read a research area from the kept copy, with where it sits", async () => {
    const { t, alice } = await setup();
    await t.run(async (ctx) => {
      const node = { level: "topic" as const, path: ["Physical Sciences", "Earth and Planetary Sciences", "Geochemistry and Petrology"], ancestors: ["domains/3", "fields/19", "subfields/1908"], childCount: 0, revision: CATALOG_REVISION, searchText: "", domainId: "domains/3", fieldId: "fields/19", subfieldId: "subfields/1908" };
      await ctx.db.insert("topicCatalog", { ...node, id: "T10001", name: "Geological and Geochemical Analysis", parent: "subfields/1908" });
      await ctx.db.insert("topicCatalog", { ...node, id: "fields/19", name: "Earth and Planetary Sciences", parent: "domains/3", level: "field" });
      await ctx.db.insert("topicDetails", { id: "T10001", description: "Rocks and what they hold.", keywords: ["geochemistry"], worksCount: 51_000, fetchedAt: Date.now(), revision: CATALOG_REVISION });
    });
    expect(await alice.action(api.research.topics.get, { id: "t10001" })).toMatchObject({ id: "T10001", name: "Geological and Geochemical Analysis", description: "Rocks and what they hold.", keywords: ["geochemistry"], papers: 51_000, within: [{ id: "fields/19", name: "Earth and Planetary Sciences" }], link: "[Geological and Geochemical Analysis](/topics/T10001)" });
    expect(requests).toEqual([]);
    await expect(alice.action(api.research.topics.get, { id: "fields/19" })).rejects.toThrow(/topic ID, such as T10011/);
  });

  it("name a saved search's filters by their IDs, one request for each kind, and research areas from the catalog", async () => {
    const { alice } = await setup();
    const named = await alice.action(api.research.lookup.names, { ids: ["A1", "a2", "F404", "https://openalex.org/S3", "t10001", "fields/33"] });
    expect(named).toEqual(expect.arrayContaining([
      { id: "T10001", name: "Geological and Geochemical Analysis" }, { id: "fields/33", name: "Social Sciences" },
      { id: "A1", name: "Name of A1" }, { id: "A2", name: "Name of A2" }, { id: "S3", name: "Name of S3" },
    ]));
    // One OpenAlex has no record of is left out.
    expect(named.map((one) => one.id)).not.toContain("F404");
    expect(requests.map((url) => url.pathname.split("/").at(-1)).sort()).toEqual(["authors", "funders", "sources"]);
    requests = [];
    await expect(alice.action(api.research.lookup.names, { ids: ["A1", "W2741809807"] })).rejects.toThrow(/W2741809807 isn't an ID a filter names/);
    await expect(alice.action(api.research.lookup.names, { ids: Array.from({ length: 51 }, (_, i) => `A${i}`) })).rejects.toThrow(/between 1 and 50/);
    expect(requests).toEqual([]);
  });

  it("cite a paper in a style, from its record when the publisher has no metadata", async () => {
    const { alice } = await setup();
    const cited = await alice.action(api.research.citations.cite, { id: "W7", style: "APA" });
    expect(cited).toMatchObject({ title: "Tutoring at scale", style: "APA 7" });
    expect(cited.citation).toContain("Tutoring at scale");
    expect(cited.citation).toContain("2020");
    // A style there isn't is refused before OpenAlex is asked for the paper.
    requests = [];
    await expect(alice.action(api.research.citations.cite, { id: "W7", style: "no-such-style" })).rejects.toThrow(/No citation style is called .{0,2}no-such-style/);
    expect(requests).toEqual([]);
    await expect(alice.action(api.research.citations.cite, { id: "10.1234/x", style: "apa" })).rejects.toThrow(/by its ID, such as W2741809807/);
  });

  it("list the models a chat can run on, found by name", async () => {
    const { t, alice } = await setup();
    await t.run(async (ctx) => {
      const model = { provider: "openrouter", inputPricePerMillion: 0.1, outputPricePerMillion: 0.4, costMarkup: 1, contextLength: 400_000, inputModalities: ["text", "image", "file"], isServed: true, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1 };
      await ctx.db.insert("models", { ...model, modelId: "openai/gpt-6-luna", name: "OpenAI: GPT-6 Luna", supportedParameters: ["tools"] });
      // Without tools it can't run a chat, and one an admin hid isn't offered.
      await ctx.db.insert("models", { ...model, modelId: "openai/gpt-6-luna-nano", name: "OpenAI: GPT-6 Luna Nano", supportedParameters: [] });
      await ctx.db.insert("models", { ...model, modelId: "openai/gpt-6-luna-pro", name: "OpenAI: GPT-6 Luna Pro", supportedParameters: ["tools"], hidden: true });
    });
    expect(await alice.query(api.assistant.threads.models, { search: "luna" })).toEqual([expect.objectContaining({ name: "OpenAI: GPT-6 Luna", readsPdfs: true, readsImages: true, context: 400_000 })]);
    expect(await alice.query(api.assistant.threads.models, { search: "claude" })).toEqual([]);
  });
});
