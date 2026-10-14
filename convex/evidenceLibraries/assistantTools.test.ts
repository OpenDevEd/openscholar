// The assistant reads an Evidence Library's records and keeps a person's collections there (plans/evidence-library-sources,
// stage 5): a page of any source as the person may read it, and a change to a collection that its undo reverses exactly.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { encrypt } from "../lib/crypto";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

const KEY = "1".repeat(64);
const READ = "6f1c2a7e-0000-4000-8000-000000000001";
const keyAt = (at: number) => `K${String(at).padStart(7, "0")}`;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Call = { method: string; path: string; body: Record<string, unknown> | null };

async function setup(name: string) {
  const fixture = await createReadySetupFixture(name);
  const libraryId = fixture.created.libraryId;
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  await fixture.t.run(async (ctx) => {
    const credential = (await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).collect()).find((row) => row.credentialKey === "library-service")!;
    await ctx.db.patch("evidenceLibraryCredentials", credential._id, { encryptedValue: encrypt("machine-secret", KEY) });
  });
  const calls: Call[] = [];
  // A search of 30 records, each with a long abstract, the even ones with a PDF; the collection holds the first already.
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? "GET", path: url.pathname, body });
    if (url.pathname === "/api/v1/openscholar/sources/resolve") {
      const keys = "records" in body.source ? (body.source.records as string[]) : Array.from({ length: 30 }, (_, at) => keyAt(at));
      return Response.json({ keys: keys.slice(body.first - 1, body.last), total: keys.length, truncated: false });
    }
    if (url.pathname === "/api/v1/openscholar/records/batch") {
      return Response.json({
        records: (body.keys as string[]).map((key) => ({ key, revision: 1, itemType: "journalArticle", title: `Tutoring ${key}`, abstract: "a".repeat(900), creators: [{ name: "Ada Okafor" }], year: 2021, venue: null, url: null, crossRefs: { doi: `10.1/${key.toLowerCase()}` }, files: Number(key.slice(1)) % 2 === 0 ? [{ attachmentKey: "PDF00001", filename: "paper.pdf", contentType: "application/pdf" }] : [] })),
        unread: [],
      });
    }
    if (url.pathname.startsWith("/api/v1/openscholar/collections/")) return Response.json({ id: READ, name: "Reading list", description: null, private: true, count: 3, access: "owner" });
    if (url.pathname.endsWith("/records")) {
      const keys = body.keys as string[];
      const changed = init?.method === "POST" ? keys.filter((key) => key !== keyAt(0) && key !== "HIDDENKY") : keys;
      return Response.json({ count: 4, changed, missing: init?.method === "POST" ? keys.filter((key) => key === "HIDDENKY") : [] });
    }
    return new Response("Not found", { status: 404 });
  }));
  const person = fixture.t.withIdentity({ subject: fixture.clerkUserId });
  const workspaceId = (await person.query(api.workspaces.queries.personal, {}))!;
  return { ...fixture, libraryId, calls, person, workspaceId };
}

it("reads a library search a page at a time, and records by key whole, each with its link on the library", async () => {
  const { libraryId, calls, person, workspaceId } = await setup("libtools-read");
  const address = await person.query(api.evidenceLibraries.readers.address, { workspaceId, libraryId });

  const first = await person.action(api.evidenceLibraries.library.records, { workspaceId, libraryId, source: { search: "search=tutoring&sort=mostCited" } });
  expect(first).toMatchObject({ total: 30, next: 25 });
  expect(first.records).toHaveLength(25);
  expect(first.records[0]).toMatchObject({ paper: `library:${libraryId}:${keyAt(0)}`, key: keyAt(0), doi: `10.1/${keyAt(0).toLowerCase()}`, pdf: true, link: `[Tutoring ${keyAt(0)}](${new URL(`/lib/${keyAt(0)}`, address!).href})` });
  expect(first.records[1]?.pdf).toBe(false);
  expect(first.records[0]?.abstract).toBe(`${"a".repeat(600)}…`);
  // Asked as the person, for the window the page is.
  expect(calls.find((call) => call.path === "/api/v1/openscholar/sources/resolve")?.body).toMatchObject({ reader: expect.any(String), source: { search: "search=tutoring&sort=mostCited" }, first: 1, last: 25 });

  const last = await person.action(api.evidenceLibraries.library.records, { workspaceId, libraryId, source: { search: "search=tutoring&sort=mostCited" }, start: 25 });
  expect(last.records.map((record) => record.key)).toEqual([25, 26, 27, 28, 29].map(keyAt));
  expect(last.next).toBeUndefined();

  const named = await person.action(api.evidenceLibraries.library.records, { workspaceId, libraryId, source: { records: [keyAt(3)] } });
  expect(named.records[0]?.abstract).toBe("a".repeat(900));
  // Another library's record isn't read here by its key alone.
  await expect(person.action(api.evidenceLibraries.library.records, { workspaceId, libraryId, source: { records: [`library:r1another0000000000000000000000:${keyAt(3)}`] } })).rejects.toThrow(/another Evidence Library/);
});

it("puts records in a collection the person edits, and its undo takes out only the ones that went in", async () => {
  const { libraryId, calls, person, workspaceId } = await setup("libtools-change");
  const records = () => calls.filter((call) => call.path.endsWith(`/collections/${READ}/records`));

  // The person was asked about the collection by the name given: another collection's changes nothing.
  await expect(person.action(api.evidenceLibraries.library.changeRecords, { workspaceId, libraryId, collection: READ, collectionName: "Included", keys: [keyAt(1)], change: "add" })).rejects.toThrow(/Reading list.+not.+Included/);
  expect(records()).toEqual([]);

  const added = await person.action(api.evidenceLibraries.library.changeRecords, { workspaceId, libraryId, collection: READ, collectionName: "reading list", keys: [keyAt(0), keyAt(1), `library:${libraryId}:${keyAt(2)}`, keyAt(1), "HIDDENKY"], change: "add" });
  expect(added).toEqual({ count: 4, changed: 2, missing: ["HIDDENKY"], undo: { path: "evidenceLibraries/library:changeRecords", args: { libraryId, collection: READ, keys: [keyAt(1), keyAt(2)], change: "remove" } } });

  await person.action(api.evidenceLibraries.library.changeRecords, { workspaceId, ...added.undo!.args });
  expect(records().at(-1)).toMatchObject({ method: "DELETE", body: { keys: [keyAt(1), keyAt(2)] } });
});

it("undoes a change to a library collection from its step's card, as the person it was made for", async () => {
  const { t, libraryId, calls, person, workspaceId, clerkUserId } = await setup("libtools-undo");
  const { threadId, stepId } = await t.run(async (ctx) => {
    await ctx.db.insert("featureFlags", { key: "assistant.enabled", enabled: true, updatedAt: 1 });
    const userId = (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique())!._id;
    const threadId = await ctx.db.insert("assistantThreads", { workspaceId, createdBy: userId, title: "Reading list", agentThreadId: "agent", lastMessageAt: 1, createdAt: 1, updatedAt: 1 });
    // The assistant took K0000001 out of the collection; its undo puts it back, through the library.
    const undo = { path: "evidenceLibraries/library:changeRecords", args: JSON.stringify({ libraryId, collection: READ, keys: [keyAt(1)], change: "add" }), action: true as const };
    const stepId = await ctx.db.insert("assistantSteps", { threadId, workspaceId, order: 0, userId, toolCallId: "call", path: "evidenceLibraries/library:changeRecords", input: "{}", status: "done", undo, startedAt: 1, endedAt: 1 });
    return { threadId, stepId };
  });
  // Undo's one transaction can't reach the library: the card sends it to the action that can.
  await expect(person.mutation(api.assistant.undo.run, { threadId, stepIds: [stepId] })).rejects.toThrow(/can no longer be undone/);
  await person.action(api.assistant.undo.runAction, { threadId, stepId });
  expect(calls.filter((call) => call.path.endsWith(`/collections/${READ}/records`)).at(-1)).toMatchObject({ method: "POST", body: { keys: [keyAt(1)] } });
  expect(await t.run((ctx) => ctx.db.get("assistantSteps", stepId))).toMatchObject({ undone: true });
  await expect(person.action(api.assistant.undo.runAction, { threadId, stepId })).rejects.toThrow(/nothing left to undo/);
});
