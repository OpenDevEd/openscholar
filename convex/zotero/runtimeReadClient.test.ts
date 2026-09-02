import { describe, expect, it, vi } from "vitest";
import {
  RuntimeReadError,
  readRuntimeCollections,
  readRuntimeCollectionsByIds,
  readRuntimeInstitutions,
} from "./runtimeReadClient";

const credential = `els_${"a".repeat(43)}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("readRuntimeCollections", () => {
  it("asks the library with its machine credential and returns the page", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(
        "https://lib.example.test/api/openscholar/collections",
      );
      expect(url.searchParams.get("query")).toBe("climate");
      expect(url.searchParams.get("cursor")).toBe("p2");
      expect(url.searchParams.get("pageSize")).toBe("50");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${credential}`,
      );
      return jsonResponse({
        items: [
          {
            id: "ABCD1234",
            title: "Climate",
            count: 12,
            source: "zotero-42",
            parentId: null,
          },
        ],
        nextCursor: "p3",
      });
    });
    await expect(
      readRuntimeCollections(fetchImpl, {
        baseUrl: "https://lib.example.test",
        credential,
        query: "climate",
        cursor: "p2",
      }),
    ).resolves.toEqual({
      items: [
        {
          id: "ABCD1234",
          title: "Climate",
          count: 12,
          source: "zotero-42",
          parentId: null,
        },
      ],
      nextCursor: "p3",
    });
  });

  it("reports a refused or broken answer", async () => {
    const refused = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: {} }, 401),
    );
    await expect(
      readRuntimeCollections(refused, {
        baseUrl: "https://lib.example.test",
        credential,
      }),
    ).rejects.toMatchObject({
      code: "RUNTIME_READ_REFUSED",
    } satisfies Partial<RuntimeReadError>);
    const broken = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [{ id: 1 }] }),
    );
    await expect(
      readRuntimeCollections(broken, {
        baseUrl: "https://lib.example.test",
        credential,
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_READ_INVALID" });
  });
});

describe("readRuntimeInstitutions", () => {
  it("asks for one page of names with the search text, cursor and sort", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(
        "https://lib.example.test/api/openscholar/institutions",
      );
      expect(url.searchParams.get("query")).toBe("nairobi");
      expect(url.searchParams.get("cursor")).toBe("p2");
      expect(url.searchParams.get("sort")).toBe("name");
      expect(url.searchParams.get("direction")).toBe("asc");
      expect(url.searchParams.get("pageSize")).toBe("50");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${credential}`,
      );
      return jsonResponse({
        items: [{ name: "University of Nairobi", count: 4 }],
        nextCursor: "p3",
      });
    });
    await expect(
      readRuntimeInstitutions(fetchImpl, {
        baseUrl: "https://lib.example.test",
        credential,
        query: "nairobi",
        cursor: "p2",
        sort: "name",
        direction: "asc",
      }),
    ).resolves.toEqual({
      items: [{ name: "University of Nairobi", count: 4 }],
      nextCursor: "p3",
    });
  });

  it("treats a library that answers without a cursor as one page", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [{ name: "Makerere University", count: 2 }] }),
    );
    await expect(
      readRuntimeInstitutions(fetchImpl, {
        baseUrl: "https://lib.example.test",
        credential,
      }),
    ).resolves.toEqual({
      items: [{ name: "Makerere University", count: 2 }],
      nextCursor: null,
    });
  });

  it("reports a broken answer", async () => {
    const broken = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [{ name: 1, count: 1 }] }),
    );
    await expect(
      readRuntimeInstitutions(broken, {
        baseUrl: "https://lib.example.test",
        credential,
      }),
    ).rejects.toMatchObject({
      code: "RUNTIME_READ_INVALID",
    } satisfies Partial<RuntimeReadError>);
  });
});

describe("readRuntimeCollectionsByIds", () => {
  it("asks the library for exactly the ids it needs", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/openscholar/collections");
      expect(url.searchParams.get("ids")).toBe("COLL0001,COLL0002");
      // `ids` is the only parameter this answer accepts.
      expect(url.searchParams.get("query")).toBeNull();
      expect(url.searchParams.get("cursor")).toBeNull();
      return jsonResponse({
        items: [
          {
            id: "COLL0001",
            title: "Climate",
            source: "zotero-42",
            count: 12,
            parentId: null,
          },
          {
            id: "COLL0002",
            title: "Health",
            source: "zotero-42",
            count: 3,
            parentId: null,
          },
        ],
        nextCursor: null,
      });
    });
    await expect(
      readRuntimeCollectionsByIds(fetchImpl, {
        baseUrl: "https://lib.example.test",
        credential,
        ids: ["COLL0001", "COLL0002"],
      }),
    ).resolves.toEqual({
      items: [
        { id: "COLL0001", title: "Climate", source: "zotero-42", count: 12 },
        { id: "COLL0002", title: "Health", source: "zotero-42", count: 3 },
      ],
    });
  });

  it("answers nothing when the library does not know the ids yet", async () => {
    // A library that has not learned about `ids` answers with its own first
    // page instead. Those rows are not answers to the question, so only rows
    // that were asked for are kept.
    const olderRuntime = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        items: [
          {
            id: "OTHER",
            title: "Something else",
            count: 1,
            source: "s",
            parentId: null,
          },
        ],
        nextCursor: "p2",
      }),
    );
    await expect(
      readRuntimeCollectionsByIds(olderRuntime, {
        baseUrl: "https://lib.example.test",
        credential,
        ids: ["COLL0001"],
      }),
    ).resolves.toEqual({ items: [] });
  });

  it("refuses a batch larger than the library allows", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [] }),
    );
    await expect(
      readRuntimeCollectionsByIds(fetchImpl, {
        baseUrl: "https://lib.example.test",
        credential,
        ids: Array.from({ length: 201 }, (_, index) => `COLL${index}`),
      }),
    ).rejects.toThrow(/at most 200/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a broken row instead of leaving it out", async () => {
    const broken = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        items: [
          {
            id: "COLL0001",
            title: "Climate",
            source: "zotero-42",
            count: 12,
            parentId: null,
          },
          {
            id: "COLL0002",
            title: 7,
            source: "zotero-42",
            count: 3,
            parentId: null,
          },
        ],
        nextCursor: null,
      }),
    );
    await expect(
      readRuntimeCollectionsByIds(broken, {
        baseUrl: "https://lib.example.test",
        credential,
        ids: ["COLL0001", "COLL0002"],
      }),
    ).rejects.toMatchObject({
      code: "RUNTIME_READ_INVALID",
    } satisfies Partial<RuntimeReadError>);
  });

  it("asks for nothing when there are no ids", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [] }),
    );
    await expect(
      readRuntimeCollectionsByIds(fetchImpl, {
        baseUrl: "https://lib.example.test",
        credential,
        ids: [],
      }),
    ).resolves.toEqual({ items: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
