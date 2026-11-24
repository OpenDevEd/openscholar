import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { fakeStore, storeAnswer, storedAddress, stubPaperStore } from "../lib/paperPdfs.test-support";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("finds the paper a community's record page shows, at its own address or its domain, once it's published", async () => {
  const { t, created, clerkUserId } = await createReadySetupFixture("paper_links");
  const libraryId = created.libraryId;
  const origin = await t.run(async (ctx) => {
    const binding = await ctx.db.query("evidenceLibraryRuntimeBindings").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).first();
    await ctx.db.insert("evidenceLibraryDomains", { libraryId, host: "climate.example.org", verificationToken: "token", verificationHost: "example.org", role: "primary", state: "added", generation: 0, createdByClerkUserId: clerkUserId, createdAt: 1, updatedAt: 1, attachedAt: 1 });
    // A domain added but not yet serving the community names nothing.
    await ctx.db.insert("evidenceLibraryDomains", { libraryId, host: "pending.example.org", verificationToken: "token", verificationHost: "example.org", role: "redirect", state: "added", generation: 0, createdByClerkUserId: clerkUserId, createdAt: 1, updatedAt: 1 });
    const record = { libraryId, generation: 1, publishedRevision: 1, topicIds: [], metadata: null, groupKey: "g" };
    await ctx.db.insert("topicLocations", { ...record, itemKey: "ABCD2345", state: "published", openalexId: "W1", doi: "10.1000/one" });
    await ctx.db.insert("topicLocations", { ...record, itemKey: "EFGH6789", state: "unpublished", openalexId: "W2", doi: null });
    return binding!.targetBaseUrl;
  });
  const paper = (at: string, itemKey: string) => t.query(internal.evidenceLibraries.paperLinks.recordPaper, { origin: at, itemKey });
  const known = { openalexId: "W1", doi: "10.1000/one" };
  expect(await paper(origin, "ABCD2345")).toEqual({ community: true, paper: known });
  expect(await paper("https://climate.example.org", "ABCD2345")).toEqual({ community: true, paper: known });
  // One the community took down is the community's own site's to say; an address no community serves names nothing.
  expect(await paper("https://climate.example.org", "EFGH6789")).toEqual({ community: true, paper: null });
  expect(await paper("https://example.org", "ABCD2345")).toEqual({ community: false, paper: null });
  expect(await paper("https://pending.example.org", "ABCD2345")).toEqual({ community: false, paper: null });
});

it("answers a community that asks with its credential, link by link in order, and no one else", async () => {
  const { t, created, clerkUserId } = await createReadySetupFixture("paper_links_http");
  const libraryId = created.libraryId;
  const token = "els_" + "c".repeat(43);
  const origin = await t.run(async (ctx) => {
    // The community's machine credential, as its setup stored one: its digest is this token's.
    const credential = await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId_and_credentialKey", (q) => q.eq("libraryId", libraryId).eq("credentialKey", "library-service")).unique();
    const digest = createHash("sha256").update(token).digest("hex");
    if (credential) await ctx.db.patch("evidenceLibraryCredentials", credential._id, { credentialDigest: digest });
    else await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: digest, validationState: "valid", createdByClerkUserId: clerkUserId, updatedByClerkUserId: clerkUserId, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("topicLocations", { libraryId, generation: 1, publishedRevision: 1, topicIds: [], metadata: null, groupKey: "g", itemKey: "ABCD2345", state: "published", openalexId: "W1", doi: null });
    return (await ctx.db.query("evidenceLibraryRuntimeBindings").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).first())!.targetBaseUrl;
  });
  const ask = (links: string[], credential = token) =>
    t.fetch("/api/v1/evidence-libraries/papers/resolve", { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify({ contractVersion: 1, libraryId, links }) });
  // A record Openscholar has no word of is read from the community's own site, as its public record.
  const site = vi.fn(async (url: string, _init?: RequestInit) => (url === `${origin}/api/item/QQQQ2345` ? Response.json({ item: { key: "QQQQ2345", openalexId: "W9", DOI: "10.1000/Nine" } }) : new Response("Not found", { status: 404 })));
  vi.stubGlobal("fetch", site);
  const answered = await ask([`${origin}/lib/ABCD2345`, "https://example.org/nothing", "https://doi.org/10.1000/Two", `${origin}/lib/QQQQ2345`, `${origin}/lib/ZZZZ2345`]);
  expect(answered.status).toBe(200);
  expect(await answered.json()).toEqual({ papers: [{ openalexId: "W1", doi: null }, null, { openalexId: null, doi: "10.1000/two" }, { openalexId: "W9", doi: "10.1000/nine" }, null] });
  // Only the known community's site was asked: an address no community serves isn't fetched.
  expect(site.mock.calls.map(([url]) => url)).toEqual([`${origin}/api/item/QQQQ2345`, `${origin}/api/item/ZZZZ2345`]);
  // With the shield's check, which a shielded community needs to answer a read at all.
  expect(site.mock.calls[0]![1]?.headers).toMatchObject({ cookie: expect.stringContaining("ode_browser_check") });
  expect((await ask(["W1"], "els_" + "d".repeat(43))).status).toBe(401);
  // The same credential asks which of its DOIs are Openscholar Reports: one that names none is null, in the order asked.
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://openscholar.test");
  const reports = (dois: string[], credential = token) =>
    t.fetch("/api/v1/evidence-libraries/reports/records", { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify({ contractVersion: 1, libraryId, dois }) });
  const none = await reports(["https://doi.org/10.1000/Two"]);
  expect(none.status).toBe(200);
  expect(await none.json()).toEqual({ reports: [null] });
  expect((await reports(["10.1000/two"], "els_" + "d".repeat(43))).status).toBe(401);
  expect((await reports([])).status).toBe(400);
});

it("finds papers by a title on the index the site searches, for a community's signed-in reader, as that reader's search", async () => {
  const { t, created, clerkUserId } = await createReadySetupFixture("paper_links_search");
  const libraryId = created.libraryId;
  const token = "els_" + "e".repeat(43);
  await t.run(async (ctx) => {
    const credential = await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId_and_credentialKey", (q) => q.eq("libraryId", libraryId).eq("credentialKey", "library-service")).unique();
    const digest = createHash("sha256").update(token).digest("hex");
    if (credential) await ctx.db.patch("evidenceLibraryCredentials", credential._id, { credentialDigest: digest });
    else await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: digest, validationState: "valid", createdByClerkUserId: clerkUserId, updatedByClerkUserId: clerkUserId, createdAt: 1, updatedAt: 1 });
  });
  vi.stubEnv("OPENALEX_API_KEY", "platform-key");
  vi.stubEnv("OPENALEX_CONTACT_EMAIL", "contact@example.test");
  // The index answers with a work OpenAlex has, one known only by its DOI, and one neither names.
  const index = vi.fn(async (_url: string | URL) => Response.json({ meta: { count: 3 }, results: [{ id: "https://openalex.org/W5", doi: "https://doi.org/10.1000/Five" }, { id: "OS77", doi: "https://doi.org/10.1000/seven" }, { id: "OS78", doi: null }] }));
  vi.stubGlobal("fetch", index);
  const ask = (query: string, credential = token) =>
    t.fetch("/api/v1/evidence-libraries/papers/search", { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify({ contractVersion: 1, libraryId, query, clerkUserId }) });
  const answered = await ask("The power of feedback");
  expect(answered.status).toBe(200);
  // What a community can add: by its work, or by its DOI where OpenAlex has no work for it.
  expect(await answered.json()).toEqual({ papers: [{ openalexId: "W5", doi: "10.1000/five" }, { openalexId: null, doi: "10.1000/seven" }] });
  const asked = new URL(String(index.mock.calls[0]![0]));
  expect(asked.searchParams.get("search")).toBe("The power of feedback");
  expect((await ask("The power of feedback", "els_" + "f".repeat(43))).status).toBe(401);
  // Too short to be a title.
  expect((await ask("ab")).status).toBe(400);
});

it("gives a community a link to Openscholar's stored copy of a paper's PDF, for nothing, and no one else", async () => {
  const { t, created, clerkUserId } = await createReadySetupFixture("paper_links_stored");
  const libraryId = created.libraryId;
  const token = "els_" + "e".repeat(43);
  await t.run(async (ctx) => {
    // The community's machine credential, as its setup stored one: its digest is this token's.
    const credential = await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId_and_credentialKey", (q) => q.eq("libraryId", libraryId).eq("credentialKey", "library-service")).unique();
    const digest = createHash("sha256").update(token).digest("hex");
    if (credential) await ctx.db.patch("evidenceLibraryCredentials", credential._id, { credentialDigest: digest });
    else await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: digest, validationState: "valid", createdByClerkUserId: clerkUserId, updatedByClerkUserId: clerkUserId, createdAt: 1, updatedAt: 1 });
  });
  stubPaperStore();
  fakeStore.reset();
  fakeStore.objects.set("openalex/W7.pdf", new TextEncoder().encode("%PDF-1.7"));
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => (await storeAnswer(input, init)) ?? new Response("Not found", { status: 404 }));
  const ask = (paper: Record<string, string>, credential = token) =>
    t.fetch("/api/v1/evidence-libraries/papers/stored-pdf", { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify({ contractVersion: 1, libraryId, ...paper }) });

  // A copy the store holds comes back as a signed link to it.
  const held = await ask({ openalexId: "https://openalex.org/W7", url: "https://example.org/w7.pdf" });
  expect(held.status).toBe(200);
  expect(((await held.json()) as { link: string }).link).toContain(`${storedAddress("openalex/W7.pdf")}?`);
  // A paper it has no copy of names none, and nothing is bought or fetched for it.
  expect(await (await ask({ openalexId: "W8" })).json()).toEqual({ link: null });
  // Nobody's charged for a community's read.
  expect(await t.run(async (ctx) => (await ctx.db.query("paperPdfReads").take(1)).length)).toBe(0);

  expect((await ask({ openalexId: "W7" }, "els_" + "f".repeat(43))).status).toBe(401);
  expect((await ask({})).status).toBe(400);
});
