// A library hands records, a search or a collection to OpenScholar (plans/evidence-library-sources):
// whoever opens the hand-off reads its source as themselves, until it expires.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { encrypt } from "../lib/crypto";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

const KEY = "1".repeat(64);
const TOKEN = "els_" + "a".repeat(43);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("hands records over with their questions, read as whoever opens them, until a week has passed", async () => {
  const { t, created } = await createReadySetupFixture("handoffs");
  const libraryId = created.libraryId;
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://openscholar.example");
  await t.run(async (ctx) => {
    const credential = (await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).collect()).find((row) => row.credentialKey === "library-service")!;
    await ctx.db.patch("evidenceLibraryCredentials", credential._id, { encryptedValue: encrypt(TOKEN, KEY), credentialDigest: createHash("sha256").update(TOKEN).digest("hex") });
    await ctx.db.insert("users", { clerkId: "user_reader", email: "reader@example.org", state: "active", createdAt: 1, updatedAt: 1 });
  });
  const handOff = async (body: unknown, { credential = TOKEN, contract = "1" } = {}) => {
    const response = await t.fetch("/api/v1/evidence-libraries/handoffs", {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json", ...(contract ? { "OpenScholar-Contract": contract } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, contract: response.headers.get("OpenScholar-Contract"), body: (await response.json()) as Record<string, unknown> };
  };
  const handoff = { libraryId, clerkUserId: "user_writer", from: "smartScreening", source: { records: ["AAAAAAAA", "BBBBBBBB"] }, fields: [{ label: "Randomized", type: "boolean", description: "Were people assigned at random?" }] };

  // Every answer says the contract it speaks; only the library's own credential and a well-formed hand-off are taken.
  expect(await handOff(handoff, { contract: "" })).toMatchObject({ status: 400, contract: "1", body: { error: "contract" } });
  expect(await handOff(handoff, { credential: "els_" + "b".repeat(43) })).toMatchObject({ status: 401, body: { error: "invalid_service_credential" } });
  expect(await handOff({ ...handoff, fields: [{ label: "When", type: "date", description: "" }] })).toMatchObject({ status: 400, body: { error: "invalid_request" } });
  expect(await handOff({ ...handoff, source: { records: ["AAAAAAAA"], search: "q=tutoring" } })).toMatchObject({ status: 400 });

  const made = await handOff(handoff);
  expect(made.status).toBe(201);
  const handoffId = made.body.handoffId as string;
  expect(made.body.url).toBe(`https://openscholar.example/from-library/${handoffId}`);
  expect(made.body.expiresAt).toBe(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const asked: Array<{ path: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? "{}"));
    asked.push({ path: pathname, body });
    // The reader may read one of the two.
    if (pathname === "/api/v1/openscholar/sources/resolve") return Response.json({ keys: ["BBBBBBBB"].slice(body.first - 1, body.last), total: 1, truncated: false });
    if (pathname === "/api/v1/openscholar/records/batch") return Response.json({ records: [{ key: "BBBBBBBB", revision: 1, itemType: "journalArticle", title: "Peer tutoring", abstract: null, creators: [{ name: "Ada Okafor" }], year: 2021, venue: null, url: null, crossRefs: {}, files: [] }], unread: [] });
    return new Response("Not found", { status: 404 });
  }));
  const reader = t.withIdentity({ subject: "user_reader" });
  const workspaceId = await reader.query(api.workspaces.queries.personal, {});
  const opened = await reader.action(api.evidenceLibraries.handoffs.open, { workspaceId: workspaceId!, handoffId, records: true });
  expect(opened).toMatchObject({
    from: "smartScreening",
    fields: handoff.fields,
    found: { row: { libraryId, source: handoff.source, what: "records", records: 1 } },
    records: [{ key: "BBBBBBBB", title: "Peer tutoring", authors: ["Ada Okafor"], year: 2021 }],
  });
  // Read as the person who opened it, not the one who made it.
  expect(asked.filter((call) => call.path === "/api/v1/openscholar/sources/resolve").map((call) => call.body.reader)).toEqual(["user_reader", "user_reader"]);
  // The screening form asks for the source alone, and a list the library can't give still leaves the hand-off to start from.
  asked.length = 0;
  expect(await reader.action(api.evidenceLibraries.handoffs.open, { workspaceId: workspaceId!, handoffId })).toMatchObject({ found: { row: { records: 1 } }, records: null });
  expect(asked.map((call) => call.path)).toEqual(["/api/v1/openscholar/sources/resolve"]);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (new URL(String(input)).pathname === "/api/v1/openscholar/sources/resolve") return Response.json({ keys: ["BBBBBBBB"].slice(body.first - 1, body.last), total: 1, truncated: false });
    return new Response("Bad gateway", { status: 502 });
  }));
  expect(await reader.action(api.evidenceLibraries.handoffs.open, { workspaceId: workspaceId!, handoffId, records: true })).toMatchObject({ found: { row: { records: 1 } }, records: null });

  // The library is now one they read.
  expect((await reader.query(api.evidenceLibraries.readers.list, {})).map((library) => [library.libraryId, library.ways])).toEqual([[libraryId, ["handoff"]]]);

  // A week on, it has gone.
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.query("evidenceLibraryHandoffs").collect())).toEqual([]);
  expect(await reader.action(api.evidenceLibraries.handoffs.open, { workspaceId: workspaceId!, handoffId })).toEqual({ gone: true });
  expect(await reader.action(api.evidenceLibraries.handoffs.open, { workspaceId: workspaceId!, handoffId: "not-an-id" })).toEqual({ gone: true });
});
