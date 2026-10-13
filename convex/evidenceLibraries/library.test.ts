// A library's source as a person may read it (plans/evidence-library-sources): what one that holds nothing says.
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { encrypt } from "../lib/crypto";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

const KEY = "1".repeat(64);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("refuses a search that finds nothing as empty, and a record that isn't there as not found", async () => {
  const { t, created, clerkUserId } = await createReadySetupFixture("library-empty");
  const libraryId = created.libraryId;
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  await t.run(async (ctx) => {
    const credential = (await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).collect()).find((row) => row.credentialKey === "library-service")!;
    await ctx.db.patch("evidenceLibraryCredentials", credential._id, { encryptedValue: encrypt("machine-secret", KEY) });
  });
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => (new URL(String(input)).pathname === "/api/v1/openscholar/sources/resolve" ? Response.json({ keys: [], total: 0, truncated: false }) : new Response("Not found", { status: 404 }))));
  const person = t.withIdentity({ subject: clerkUserId });
  const workspaceId = (await person.query(api.workspaces.queries.personal, {}))!;

  const source = (source: { search: string } | { records: string[] }) => person.action(api.evidenceLibraries.library.source, { workspaceId, libraryId, source });
  expect(await source({ search: "search=zzzznoresults" })).toEqual({ error: "empty" });
  expect(await source({ records: ["ZZZZZZZZ"] })).toEqual({ error: "notFound" });
});
