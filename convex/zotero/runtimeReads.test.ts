/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { encrypt } from "../lib/crypto";
import {
  createActivatedSetupFixture,
  createReadySetupFixture,
} from "../../tests/helpers/evidence-library-setup-fixture";
import { RUNTIME_READ_CACHE_MS } from "./runtimeReadClient";

const ENCRYPTION_KEY = "55".repeat(32);
const MACHINE_CREDENTIAL = `els_${"m".repeat(43)}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// A library runtime whose answers can be changed between calls.
function runtime() {
  const state = {
    collections: [
      { id: "COLL0001", title: "Climate", count: 12, source: "zotero-42", parentId: null },
    ],
    institutions: [{ name: "University of Nairobi", count: 4 }],
  };
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (new Headers(init?.headers).get("authorization") !== `Bearer ${MACHINE_CREDENTIAL}`) {
      return jsonResponse({ error: { code: "unauthorized" } }, 401);
    }
    if (url.pathname === "/api/openscholar/collections") {
      const query = url.searchParams.get("query") ?? "";
      return jsonResponse({
        items: state.collections.filter((item) =>
          item.title.toLowerCase().includes(query.toLowerCase()),
        ),
        nextCursor: null,
      });
    }
    if (url.pathname === "/api/openscholar/institutions") {
      return jsonResponse({ items: state.institutions });
    }
    return jsonResponse({}, 404);
  });
  return { state, fetchImpl };
}

async function readyLibrary(suffix: string) {
  const fixture = await createReadySetupFixture(suffix);
  await fixture.t.run(async (ctx) => {
    const credential = await ctx.db
      .query("evidenceLibraryCredentials")
      .withIndex("by_libraryId_and_credentialKey", (q) =>
        q.eq("libraryId", fixture.created.libraryId).eq("credentialKey", "library-service"),
      )
      .unique();
    await ctx.db.patch("evidenceLibraryCredentials", credential!._id, {
      encryptedValue: encrypt(MACHINE_CREDENTIAL, ENCRYPTION_KEY),
    });
  });
  return fixture;
}

describe("Evidence Library runtime reads", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("answers with an empty list while the library is not set up", async () => {
    const fixture = await createActivatedSetupFixture("reads_draft");
    const libraryId = fixture.created.libraryId;
    await expect(
      fixture.admin.action(api.zotero.runtimeReadActions.listLibraryCollections, { libraryId }),
    ).resolves.toEqual({ reason: "not-set-up", items: [], nextCursor: null });
    await expect(
      fixture.admin.action(api.zotero.runtimeReadActions.listRecordInstitutions, { libraryId }),
    ).resolves.toEqual({ reason: "not-set-up", items: [] });
  });

  it("reads collections and institutions from the library with its machine credential", async () => {
    const fixture = await readyLibrary("reads_ready");
    const { fetchImpl } = runtime();
    vi.stubGlobal("fetch", fetchImpl);
    const libraryId = fixture.created.libraryId;

    await expect(
      fixture.admin.action(api.zotero.runtimeReadActions.listLibraryCollections, {
        libraryId,
        query: "cli",
      }),
    ).resolves.toEqual({
      items: [{ id: "COLL0001", title: "Climate", count: 12, source: "zotero-42", parentId: null }],
      nextCursor: null,
    });
    await expect(
      fixture.admin.action(api.zotero.runtimeReadActions.listRecordInstitutions, { libraryId }),
    ).resolves.toEqual({ items: [{ name: "University of Nairobi", count: 4 }] });
    expect(
      fetchImpl.mock.calls.map(([input]) => new URL(String(input)).origin),
    ).toEqual([fixture.created.publicAddress, fixture.created.publicAddress]);
  });

  it("keeps an answer for five minutes, then asks the library again", async () => {
    const fixture = await readyLibrary("reads_cache");
    const { state, fetchImpl } = runtime();
    vi.stubGlobal("fetch", fetchImpl);
    const libraryId = fixture.created.libraryId;
    const read = () =>
      fixture.admin.action(api.zotero.runtimeReadActions.listRecordInstitutions, { libraryId });

    await expect(read()).resolves.toEqual({ items: [{ name: "University of Nairobi", count: 4 }] });
    state.institutions = [{ name: "Makerere University", count: 9 }];
    await expect(read()).resolves.toEqual({ items: [{ name: "University of Nairobi", count: 4 }] });

    await fixture.t.run(async (ctx) => {
      for (const row of await ctx.db.query("evidenceLibraryRuntimeReadCache").take(10)) {
        await ctx.db.patch("evidenceLibraryRuntimeReadCache", row._id, {
          fetchedAt: row.fetchedAt - RUNTIME_READ_CACHE_MS,
        });
      }
    });
    await expect(read()).resolves.toEqual({ items: [{ name: "Makerere University", count: 9 }] });
  });

  it("refuses readers who cannot manage the library", async () => {
    const fixture = await readyLibrary("reads_member");
    vi.stubGlobal("fetch", runtime().fetchImpl);
    const outsider = fixture.t.withIdentity({
      subject: "user_outsider",
      o: { id: "org_other", rol: "org:admin" },
    });
    await expect(
      outsider.action(api.zotero.runtimeReadActions.listRecordInstitutions, {
        libraryId: fixture.created.libraryId,
      }),
    ).rejects.toThrow();
  });
});
