/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.ts");
const token = "els_" + "a".repeat(43);

const upToDate = {
  key: "zotero-42",
  provider: "zotero",
  state: "succeeded",
  searchable: 300,
  searchFailed: 0,
  changed: 14,
  lastSuccessAt: "2026-09-27T12:08:00.000Z",
  issues: { pdf_unavailable: 3 },
};
const importing = {
  ...upToDate,
  state: "running",
  phase: "import",
  done: 120,
  total: 300,
  startedAt: "2026-09-27T12:09:00.000Z",
  minutesLeft: 2,
};

async function setup() {
  const t = convexTest(schema, modules);
  const libraryId = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "status-org", evidenceLibrariesEnabled: true, name: "Library", slug: "library", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    const libraryId = await ctx.db.insert("evidenceLibraries", { organizationId, name: "Library", slug: "library", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: createHash("sha256").update(token).digest("hex"), validationState: "valid", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    return libraryId;
  });
  const post = (observedAt: string, sources: unknown[], credential = token, extra: Record<string, unknown> = {}) =>
    t.fetch("/api/v1/evidence-libraries/source-status", {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, libraryId, observedAt, sources, ...extra }),
    });
  const saved = () => t.run((ctx) => ctx.db.query("evidenceLibrarySourceStatus").collect());
  return { post, saved };
}

it("keeps the newest report, so a late or retried older one never moves status backwards", async () => {
  const { post, saved } = await setup();

  expect((await post("2026-09-27T12:10:00.000Z", [importing])).status).toBe(200);
  expect((await post("2026-09-27T12:10:05.000Z", [upToDate])).status).toBe(200);
  expect((await post("2026-09-27T12:10:00.000Z", [importing])).status).toBe(200);

  expect(await saved()).toMatchObject([
    { observedAt: Date.parse("2026-09-27T12:10:05.000Z"), sources: [{ key: "zotero-42", state: "succeeded" }] },
  ]);
});

it("refuses another library's credential and a report that breaks the contract", async () => {
  const { post, saved } = await setup();

  expect((await post("2026-09-27T12:10:00.000Z", [upToDate], "els_" + "b".repeat(43))).status).toBe(401);
  expect((await post("2026-09-27T12:10:00.000Z", [{ ...upToDate, state: "exploded" }])).status).toBe(400);
  expect((await post("not a time", [upToDate])).status).toBe(400);
  expect((await post("2026-09-27T12:10:00.000Z", [upToDate], token, { version: 2 })).status).toBe(400);
  expect(await saved()).toEqual([]);
});
