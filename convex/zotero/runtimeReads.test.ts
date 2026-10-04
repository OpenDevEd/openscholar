/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { encrypt } from "../lib/crypto";
import {
  createActivatedSetupFixture,
  createReadySetupFixture,
} from "../../tests/helpers/evidence-library-setup-fixture";

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
      {
        id: "COLL0001",
        title: "Climate",
        count: 12,
        source: "zotero-42",
        parentId: null,
        hasChildren: true,
      },
    ],
    institutions: [
      { name: "University of Nairobi", count: 4 },
      { name: "Makerere University", count: 9 },
    ],
  };
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (
      new Headers(init?.headers).get("authorization") !==
      `Bearer ${MACHINE_CREDENTIAL}`
    ) {
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
      const direction =
        url.searchParams.get("direction") ?? (sort === "name" ? "asc" : "desc");
      const cursor = url.searchParams.get("cursor");
      const matching = state.institutions
        .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) =>
          sort === "name" ? a.name.localeCompare(b.name) : a.count - b.count,
        );
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
        q
          .eq("libraryId", fixture.created.libraryId)
          .eq("credentialKey", "library-service"),
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
      fixture.admin.action(
        api.zotero.runtimeReadActions.listCollections,
        { libraryId, paginationOpts: { cursor: null, numItems: 50 } },
      ),
    ).resolves.toEqual({ reason: "not-set-up", page: [], isDone: true, continueCursor: "" });
    await expect(
      fixture.admin.action(
        api.zotero.runtimeReadActions.listInstitutions,
        { libraryId, paginationOpts: { cursor: null, numItems: 50 } },
      ),
    ).resolves.toEqual({ reason: "not-set-up", page: [], isDone: true, continueCursor: "" });
    await expect(
      fixture.admin.action(
        api.zotero.runtimeReadActions.listPublications,
        { libraryId, paginationOpts: { cursor: null, numItems: 50 } },
      ),
    ).resolves.toEqual({ reason: "not-set-up", page: [], isDone: true, continueCursor: "" });
    await expect(
      fixture.admin.action(api.zotero.runtimeReadActions.readHomeQuestions, {
        libraryId,
      }),
    ).resolves.toEqual({ reason: "not-set-up", questions: [] });
  });

  it("reads collections and institutions from the library with its machine credential", async () => {
    const fixture = await readyLibrary("reads_ready");
    const { fetchImpl } = runtime();
    vi.stubGlobal("fetch", fetchImpl);
    const libraryId = fixture.created.libraryId;

    await expect(
      fixture.admin.action(
        api.zotero.runtimeReadActions.listCollections,
        {
          libraryId,
          paginationOpts: { cursor: null, numItems: 50 },
          query: "cli",
        },
      ),
    ).resolves.toEqual({
      page: [
        {
          id: "COLL0001",
          title: "Climate",
          count: 12,
          source: "zotero-42",
          parentId: null,
          hasChildren: true,
        },
      ],
      isDone: true,
      continueCursor: "",
    });
    await expect(
      fixture.admin.action(
        api.zotero.runtimeReadActions.listInstitutions,
        {
          libraryId,
          paginationOpts: { cursor: null, numItems: 50 },
          sort: "name",
        },
      ),
    ).resolves.toEqual({
      page: [{ name: "Makerere University", count: 9 }],
      isDone: false,
      continueCursor: "second",
    });
    await expect(
      fixture.admin.action(
        api.zotero.runtimeReadActions.listInstitutions,
        {
          libraryId,
          sort: "name",
          paginationOpts: { cursor: "second", numItems: 50 },
        },
      ),
    ).resolves.toEqual({
      page: [{ name: "University of Nairobi", count: 4 }],
      isDone: true,
      continueCursor: "",
    });
    await expect(
      fixture.admin.action(
        api.zotero.runtimeReadActions.listInstitutions,
        {
          libraryId,
          paginationOpts: { cursor: null, numItems: 50 },
          query: "makerere",
        },
      ),
    ).resolves.toEqual({
      page: [{ name: "Makerere University", count: 9 }],
      isDone: true,
      continueCursor: "",
    });
    expect(
      fetchImpl.mock.calls.map(([input]) => new URL(String(input)).origin),
    ).toEqual(Array(4).fill(fixture.created.publicAddress));
  });

  it("asks the library again so recent record changes are visible", async () => {
    const fixture = await readyLibrary("reads_fresh");
    const { state, fetchImpl } = runtime();
    vi.stubGlobal("fetch", fetchImpl);
    const libraryId = fixture.created.libraryId;
    const read = () =>
      fixture.admin.action(
        api.zotero.runtimeReadActions.listInstitutions,
        { libraryId, paginationOpts: { cursor: null, numItems: 50 } },
      );

    await expect(read()).resolves.toEqual({
      page: [{ name: "Makerere University", count: 9 }],
      isDone: false,
      continueCursor: "second",
    });
    state.institutions = [{ name: "Strathmore University", count: 1 }];
    await expect(read()).resolves.toEqual({
      page: [{ name: "Strathmore University", count: 1 }],
      isDone: true,
      continueCursor: "",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("names the collections the owner already shows, and skips ids the library does not know", async () => {
    const fixture = await readyLibrary("reads_resolve");
    const { fetchImpl } = runtime();
    vi.stubGlobal("fetch", fetchImpl);
    await expect(
      fixture.admin.action(
        api.zotero.runtimeReadActions.resolveLibraryCollections,
        {
          libraryId: fixture.created.libraryId,
          ids: ["COLL0001", "GONE0002"],
        },
      ),
    ).resolves.toEqual({
      items: [
        { id: "COLL0001", title: "Climate", source: "zotero-42", count: 12 },
      ],
    });
  });

  it("answers an empty list of ids without asking the library", async () => {
    const fixture = await readyLibrary("reads_resolve_none");
    const { fetchImpl } = runtime();
    vi.stubGlobal("fetch", fetchImpl);
    await expect(
      fixture.admin.action(
        api.zotero.runtimeReadActions.resolveLibraryCollections,
        {
          libraryId: fixture.created.libraryId,
          ids: [],
        },
      ),
    ).resolves.toEqual({ items: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks about a long list of collections in batches and puts the answer together", async () => {
    const fixture = await readyLibrary("reads_batches");
    const { state, fetchImpl } = runtime();
    state.collections = Array.from({ length: 250 }, (_, index) => ({
      id: `COLL${String(index).padStart(4, "0")}`,
      title: `Collection ${index}`,
      count: index,
      source: "zotero-42",
      parentId: null,
      hasChildren: true,
    }));
    vi.stubGlobal("fetch", fetchImpl);
    const result = await fixture.admin.action(
      api.zotero.runtimeReadActions.resolveLibraryCollections,
      {
        libraryId: fixture.created.libraryId,
        ids: state.collections.map((item) => item.id),
      },
    );
    expect(result.items).toHaveLength(250);
    expect(result.items.at(-1)).toEqual({
      id: "COLL0249",
      title: "Collection 249",
      source: "zotero-42",
      count: 249,
    });
    // Two calls: the library answers at most 200 ids at a time.
    expect(fetchImpl.mock.calls).toHaveLength(2);
    expect(
      fetchImpl.mock.calls.map(
        ([input]) =>
          (new URL(String(input)).searchParams.get("ids") ?? "").split(",")
            .length,
      ),
    ).toEqual([200, 50]);
  });

  it("answers collections in the order they were asked for", async () => {
    const fixture = await readyLibrary("reads_order");
    const { state, fetchImpl } = runtime();
    state.collections = ["COLL0001", "COLL0002", "COLL0003"].map(
      (id, index) => ({
        id,
        title: `Collection ${index}`,
        count: index,
        source: "zotero-42",
        parentId: null,
        hasChildren: true,
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const ask = (ids: string[]) =>
      fixture.admin.action(
        api.zotero.runtimeReadActions.resolveLibraryCollections,
        {
          libraryId: fixture.created.libraryId,
          ids,
        },
      );

    // The library answers in its own order; the caller's order is kept.
    const reversed = await ask(["COLL0003", "COLL0002", "COLL0001"]);
    expect(reversed.items.map((item) => item.id)).toEqual([
      "COLL0003",
      "COLL0002",
      "COLL0001",
    ]);
    const forward = await ask(["COLL0001", "COLL0002", "COLL0003"]);
    expect(forward.items.map((item) => item.id)).toEqual([
      "COLL0001",
      "COLL0002",
      "COLL0003",
    ]);
    expect(fetchImpl.mock.calls).toHaveLength(2);
  });

  it("refuses a list longer than a site can show", async () => {
    const fixture = await readyLibrary("reads_too_many");
    const { fetchImpl } = runtime();
    vi.stubGlobal("fetch", fetchImpl);
    await expect(
      fixture.admin.action(
        api.zotero.runtimeReadActions.resolveLibraryCollections,
        {
          libraryId: fixture.created.libraryId,
          ids: Array.from({ length: 501 }, (_, index) => `COLL${index}`),
        },
      ),
    ).rejects.toThrow(/at most 500/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an order it does not know", async () => {
    const fixture = await readyLibrary("reads_bad_args");
    vi.stubGlobal("fetch", runtime().fetchImpl);
    const libraryId = fixture.created.libraryId;
    await expect(
      fixture.admin.action(
        api.zotero.runtimeReadActions.listInstitutions,
        {
          libraryId,
          paginationOpts: { cursor: null, numItems: 50 },
          sort: "records" as unknown as "count",
        },
      ),
    ).rejects.toThrow();
    await expect(
      fixture.admin.action(
        api.zotero.runtimeReadActions.listInstitutions,
        {
          libraryId,
          paginationOpts: { cursor: null, numItems: 50 },
          direction: "sideways" as unknown as "asc",
        },
      ),
    ).rejects.toThrow();
    await expect(
      fixture.admin.action(
        api.zotero.runtimeReadActions.resolveLibraryCollections,
        {
          libraryId,
          ids: "COLL0001" as unknown as string[],
        },
      ),
    ).rejects.toThrow();
  });

  it("turns the institution order around when asked", async () => {
    const fixture = await readyLibrary("reads_direction");
    const { fetchImpl } = runtime();
    vi.stubGlobal("fetch", fetchImpl);
    const libraryId = fixture.created.libraryId;
    await expect(
      fixture.admin.action(
        api.zotero.runtimeReadActions.listInstitutions,
        {
          libraryId,
          paginationOpts: { cursor: null, numItems: 50 },
          sort: "count",
          direction: "asc",
        },
      ),
    ).resolves.toEqual({
      page: [{ name: "University of Nairobi", count: 4 }],
      isDone: false,
      continueCursor: "second",
    });
    expect(
      new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get("direction"),
    ).toBe("asc");
  });

  it("asks the library for the page size it was given, and never more than a page", async () => {
    const fixture = await readyLibrary("reads_page_size");
    const { fetchImpl } = runtime();
    vi.stubGlobal("fetch", fetchImpl);
    for (const numItems of [10, 500]) {
      await fixture.admin.action(api.zotero.runtimeReadActions.listInstitutions, {
        libraryId: fixture.created.libraryId,
        paginationOpts: { cursor: null, numItems },
      });
    }
    expect(
      fetchImpl.mock.calls.map(([input]) =>
        new URL(String(input)).searchParams.get("pageSize"),
      ),
    ).toEqual(["10", "50"]);
  });

  it("reads the one publication a saved choice names, or nothing", async () => {
    const fixture = await readyLibrary("reads_publication");
    const publication = {
      key: "PUB00001",
      title: "Reading at home",
      publishedAt: "2026-01-05T00:00:00.000Z",
      reviewer: "",
      reviewed: false,
    };
    // A library that does not read `ids` answers with its own first page.
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        jsonResponse({ items: [publication], nextCursor: null }),
      ),
    );
    const read = (key: string) =>
      fixture.admin.action(api.zotero.runtimeReadActions.readPublication, {
        libraryId: fixture.created.libraryId,
        key,
      });
    await expect(read("PUB00001")).resolves.toEqual(publication);
    await expect(read("PUB00002")).resolves.toBeNull();
  });

  it("refuses readers who cannot manage the library", async () => {
    const fixture = await readyLibrary("reads_member");
    vi.stubGlobal("fetch", runtime().fetchImpl);
    await fixture.admin.action(
      api.zotero.runtimeReadActions.listInstitutions,
      {
        libraryId: fixture.created.libraryId,
        paginationOpts: { cursor: null, numItems: 50 },
      },
    );
    const outsider = fixture.t.withIdentity({
      subject: "user_outsider",
      o: { id: "org_other", rol: "org:admin" },
    });
    await expect(
      outsider.action(api.zotero.runtimeReadActions.listInstitutions, {
        libraryId: fixture.created.libraryId,
        paginationOpts: { cursor: null, numItems: 50 },
      }),
    ).rejects.toThrow();
    // Even a question about nothing is a question about this library.
    await expect(
      outsider.action(api.zotero.runtimeReadActions.resolveLibraryCollections, {
        libraryId: fixture.created.libraryId,
        ids: [],
      }),
    ).rejects.toThrow();
    await expect(
      outsider.action(api.zotero.runtimeReadActions.resolveLibraryCollections, {
        libraryId: fixture.created.libraryId,
        ids: ["COLL0001"],
      }),
    ).rejects.toThrow();
  });
});
