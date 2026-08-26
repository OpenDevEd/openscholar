import { describe, expect, it, vi } from "vitest";
import {
  RUNTIME_READ_CACHE_MS,
  RuntimeReadError,
  collectionsCacheKey,
  isFreshRuntimeRead,
  readRuntimeCollections,
  readRuntimeInstitutions,
} from "./runtimeReadClient";

const credential = `els_${"a".repeat(43)}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("isFreshRuntimeRead", () => {
  it("keeps an answer for five minutes", () => {
    expect(isFreshRuntimeRead(1_000, 1_000 + RUNTIME_READ_CACHE_MS - 1)).toBe(true);
    expect(isFreshRuntimeRead(1_000, 1_000 + RUNTIME_READ_CACHE_MS)).toBe(false);
  });
});

describe("collectionsCacheKey", () => {
  it("separates pages and searches", () => {
    expect(collectionsCacheKey({})).toBe(collectionsCacheKey({ query: "", cursor: undefined }));
    expect(collectionsCacheKey({ query: "cli" })).not.toBe(collectionsCacheKey({}));
    expect(collectionsCacheKey({ cursor: "p2" })).not.toBe(collectionsCacheKey({}));
  });
});

describe("readRuntimeCollections", () => {
  it("asks the library with its machine credential and returns the page", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe("https://lib.example.test/api/openscholar/collections");
      expect(url.searchParams.get("query")).toBe("climate");
      expect(url.searchParams.get("cursor")).toBe("p2");
      expect(url.searchParams.get("pageSize")).toBe("50");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${credential}`);
      return jsonResponse({
        items: [{ id: "ABCD1234", title: "Climate", count: 12, source: "zotero-42", parentId: null }],
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
      items: [{ id: "ABCD1234", title: "Climate", count: 12, source: "zotero-42", parentId: null }],
      nextCursor: "p3",
    });
  });

  it("reports a refused or broken answer", async () => {
    const refused = vi.fn<typeof fetch>(async () => jsonResponse({ error: {} }, 401));
    await expect(
      readRuntimeCollections(refused, { baseUrl: "https://lib.example.test", credential }),
    ).rejects.toMatchObject({ code: "RUNTIME_READ_REFUSED" } satisfies Partial<RuntimeReadError>);
    const broken = vi.fn<typeof fetch>(async () => jsonResponse({ items: [{ id: 1 }] }));
    await expect(
      readRuntimeCollections(broken, { baseUrl: "https://lib.example.test", credential }),
    ).rejects.toMatchObject({ code: "RUNTIME_READ_INVALID" });
  });
});

describe("readRuntimeInstitutions", () => {
  it("returns names with counts", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      expect(new URL(String(input)).pathname).toBe("/api/openscholar/institutions");
      return jsonResponse({ items: [{ name: "University of Nairobi", count: 4 }] });
    });
    await expect(
      readRuntimeInstitutions(fetchImpl, { baseUrl: "https://lib.example.test", credential }),
    ).resolves.toEqual({ items: [{ name: "University of Nairobi", count: 4 }] });
  });
});
