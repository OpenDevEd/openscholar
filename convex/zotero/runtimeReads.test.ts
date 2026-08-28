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
    institutions: [
      { name: "University of Nairobi", count: 4 },
      { name: "Makerere University", count: 9 },
    ],
  };
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (new Headers(init?.headers).get("authorization") !== `Bearer ${MACHINE_CREDENTIAL}`) {
      return jsonResponse({ error: { code: "unauthorized" } }, 401);
    }
    if (url.pathname === "/api/openscholar/collections") {
      const ids = url.searchParams.get("ids");
      if (ids) {
        const wanted = new Set(ids.split(","));
        if (url.searchParams.get("query") || url.searchParams.get("cursor")) {
          return jsonResponse({ error: { code: "bad_request" } }, 400);
        }
        return jsonResponse({
          items: state.collections.filter((item) => wanted.has(item.id)),
          nextCursor: null,
        });
      }
      const query = url.searchParams.get("query") ?? "";
      return jsonResponse({
        items: state.collections.filter((item) =>
          item.title.toLowerCase().includes(query.toLowerCase()),
        ),
        nextCursor: null,
      });
    }
    if (url.pathname === "/api/openscholar/institutions") {
      const query = url.searchParams.get("query") ?? "";
      const sort = url.searchParams.get("sort") ?? "count";
      const direction = url.searchParams.get("direction") ?? (sort === "name" ? "asc" : "desc");
      const cursor = url.searchParams.get("cursor");
      const matching = state.institutions
        .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : a.count - b.count));
      if (direction === "desc") matching.reverse();
      const from = cursor === "second" ? 1 : 0;
      return jsonResponse({
        items: matching.slice(from, from + 1),
        nextCursor: from === 0 && matching.length > 1 ? "second" : null,
      });
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
    ).resolves.toEqual({ reason: "not-set-up", items: [], nextCursor: null });
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
      fixture.admin.action(api.zotero.runtimeReadActions.listRecordInstitutions, {
        libraryId,
        sort: "name",
      }),
    ).resolves.toEqual({
      items: [{ name: "Makerere University", count: 9 }],
      nextCursor: "second",
    });
    await expect(
      fixture.admin.action(api.zotero.runtimeReadActions.listRecordInstitutions, {
        libraryId,
        sort: "name",
        cursor: "second",
      }),
    ).resolves.toEqual({
      items: [{ name: "University of Nairobi", count: 4 }],
      nextCursor: null,
    });
    await expect(
      fixture.admin.action(api.zotero.runtimeReadActions.listRecordInstitutions, {
        libraryId,
        query: "makerere",
      }),
    ).resolves.toEqual({
      items: [{ name: "Makerere University", count: 9 }],
      nextCursor: null,
    });
    expect(
      fetchImpl.mock.calls.map(([input]) => new URL(String(input)).origin),
    ).toEqual(Array(4).fill(fixture.created.publicAddress));
  });

  it("keeps an answer for five minutes, then asks the library again", async () => {
    const fixture = await readyLibrary("reads_cache");
    const { state, fetchImpl } = runtime();
    vi.stubGlobal("fetch", fetchImpl);
    const libraryId = fixture.created.libraryId;
    const read = () =>
      fixture.admin.action(api.zotero.runtimeReadActions.listRecordInstitutions, { libraryId });

    await expect(read()).resolves.toEqual({
      items: [{ name: "Makerere University", count: 9 }],
      nextCursor: "second",
    });
    state.institutions = [{ name: "Strathmore University", count: 1 }];
    await expect(read()).resolves.toEqual({
      items: [{ name: "Makerere University", count: 9 }],
      nextCursor: "second",
    });

    await fixture.t.run(async (ctx) => {
      for (const row of await ctx.db.query("evidenceLibraryRuntimeReadCache").take(10)) {
        await ctx.db.patch("evidenceLibraryRuntimeReadCache", row._id, {
          fetchedAt: row.fetchedAt - RUNTIME_READ_CACHE_MS,
        });
      }
    });
    await expect(read()).resolves.toEqual({
      items: [{ name: "Strathmore University", count: 1 }],
      nextCursor: null,
    });
  });

  it("names the collections the owner already shows, and skips ids the library does not know", async () => {
    const fixture = await readyLibrary("reads_resolve");
    const { fetchImpl } = runtime();
    vi.stubGlobal("fetch", fetchImpl);
    await expect(
      fixture.admin.action(api.zotero.runtimeReadActions.resolveLibraryCollections, {
        libraryId: fixture.created.libraryId,
        ids: ["COLL0001", "GONE0002"],
      }),
    ).resolves.toEqual({
      items: [{ id: "COLL0001", title: "Climate", source: "zotero-42", count: 12 }],
    });
  });

  it("answers an empty list of ids without asking the library", async () => {
    const fixture = await readyLibrary("reads_resolve_none");
    const { fetchImpl } = runtime();
    vi.stubGlobal("fetch", fetchImpl);
    await expect(
      fixture.admin.action(api.zotero.runtimeReadActions.resolveLibraryCollections, {
        libraryId: fixture.created.libraryId,
        ids: [],
      }),
    ).resolves.toEqual({ items: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an order it does not know", async () => {
    const fixture = await readyLibrary("reads_bad_args");
    vi.stubGlobal("fetch", runtime().fetchImpl);
    const libraryId = fixture.created.libraryId;
    await expect(
      fixture.admin.action(api.zotero.runtimeReadActions.listRecordInstitutions, {
        libraryId,
        sort: "records" as unknown as "count",
      }),
    ).rejects.toThrow();
    await expect(
      fixture.admin.action(api.zotero.runtimeReadActions.listRecordInstitutions, {
        libraryId,
        direction: "sideways" as unknown as "asc",
      }),
    ).rejects.toThrow();
    await expect(
      fixture.admin.action(api.zotero.runtimeReadActions.resolveLibraryCollections, {
        libraryId,
        ids: "COLL0001" as unknown as string[],
      }),
    ).rejects.toThrow();
  });

  it("turns the institution order around when asked", async () => {
    const fixture = await readyLibrary("reads_direction");
    const { fetchImpl } = runtime();
    vi.stubGlobal("fetch", fetchImpl);
    const libraryId = fixture.created.libraryId;
    await expect(
      fixture.admin.action(api.zotero.runtimeReadActions.listRecordInstitutions, {
        libraryId,
        sort: "count",
        direction: "asc",
      }),
    ).resolves.toEqual({
      items: [{ name: "University of Nairobi", count: 4 }],
      nextCursor: "second",
    });
    expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get("direction")).toBe("asc");
  });

  it("refuses readers who cannot manage the library, even when the cache is warm", async () => {
    const fixture = await readyLibrary("reads_member");
    vi.stubGlobal("fetch", runtime().fetchImpl);
    await fixture.admin.action(api.zotero.runtimeReadActions.listRecordInstitutions, {
      libraryId: fixture.created.libraryId,
    });
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
