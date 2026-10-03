import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";

type Page = { page: string[]; isDone: boolean; continueCursor: string };
type Args = { search?: string; paginationOpts: { cursor: string | null; numItems: number; id?: number } };

// What the server holds, by search then start cursor; a page missing from it is still loading.
const server = vi.hoisted(() => ({ pages: new Map<string, Page>(), reads: [] as Args[], requests: [] as unknown[] }));
const read = (args: Args) => {
  server.reads.push(args);
  const { search = "", paginationOpts: { cursor, id = 0 } } = args;
  return server.pages.get(`${search}|${cursor}|${id}`) ?? server.pages.get(`${search}|${cursor}`);
};
vi.mock("convex/react", () => ({
  useQueries: (queries: Record<string, { args: Args }>) => {
    server.requests.push(queries);
    return Object.fromEntries(Object.entries(queries).map(([name, { args }]) => [name, read(args)]));
  },
}));
vi.mock("convex/server", () => ({ getFunctionName: (query: { name: string }) => query.name }));
vi.mock("@/components/providers/convex-provider", () => ({ useAuthReadiness: () => ({ canRunProtectedQueries: true }) }));

const query = { name: "collections:list" } as unknown as FunctionReference<"query", "public", Args, Page>;
const page = (items: string[], continueCursor: string, isDone = false): Page => ({ page: items, isDone, continueCursor });

beforeEach(() => {
  server.reads = [];
  server.requests = [];
  server.pages = new Map([
    ["|null", page(["a", "b"], "c1")],
    ["|c1", page(["c", "d"], "c2", true)],
    ["x|null", page(["x"], "", true)],
  ]);
});

describe("useCursorPage", () => {
  it("steps forward and back a page at a time", () => {
    const { result } = renderHook(() => useCursorPage(query, {}, 2));
    expect(result.current).toMatchObject({ items: ["a", "b"], page: 1, canPrevious: false, canNext: true });
    act(() => result.current.next());
    expect(result.current).toMatchObject({ items: ["c", "d"], page: 2, canPrevious: true, canNext: false });
    act(() => result.current.previous());
    expect(result.current).toMatchObject({ items: ["a", "b"], page: 1 });
  });

  it("keeps the page shown, and its number, until the next one arrives", () => {
    server.pages.delete("|c1");
    const { result, rerender } = renderHook(() => useCursorPage(query, {}, 2));
    act(() => result.current.next());
    expect(result.current).toMatchObject({ items: ["a", "b"], page: 1, isStale: true, hasPages: true });
    server.pages.set("|c1", page(["c", "d"], "c2", true));
    rerender();
    expect(result.current).toMatchObject({ items: ["c", "d"], page: 2, isStale: false });
  });

  it("starts over from the first page when its arguments change", () => {
    const { result, rerender } = renderHook(({ search }) => useCursorPage(query, { search }, 2), { initialProps: { search: undefined as string | undefined } });
    act(() => result.current.next());
    rerender({ search: "x" });
    expect(result.current).toMatchObject({ items: ["x"], page: 1, canPrevious: false, hasPages: false });
  });

  it("steps back from a page its rows were all deleted from", () => {
    const { result, rerender } = renderHook(() => useCursorPage(query, {}, 2));
    act(() => result.current.next());
    server.pages.set("|c1", page([], "c2", true));
    rerender();
    expect(result.current).toMatchObject({ items: ["a", "b"], page: 1, canPrevious: false });
  });

  it("reads a page again from its start when rows added inside it grow it past its size", () => {
    // The first read of page 1 kept its range and grew; a fresh read of it is a page again.
    server.pages.set("|null|0", page(["a", "a2", "b"], "c1"));
    const { result } = renderHook(() => useCursorPage(query, {}, 2));
    expect(result.current.items).toEqual(["a", "b"]);
    expect(server.reads.at(-1)?.paginationOpts).toMatchObject({ cursor: null, id: 1 });
  });

  it("reads on from a short page that isn't the end, asking only for the rows it lacks", () => {
    // A sparse filter: the first read stops early with one match, the next has none, the third the rest.
    server.pages.set("|null", page(["a"], "s1"));
    server.pages.set("|s1", page([], "s2"));
    server.pages.set("|s2", page(["b"], "c1"));
    const { result } = renderHook(() => useCursorPage(query, {}, 2));
    expect(result.current).toMatchObject({ items: ["a", "b"], page: 1, canNext: true });
    expect(server.reads.map((args) => [args.paginationOpts.cursor, args.paginationOpts.numItems])).toContainEqual(["s2", 1]);
    act(() => result.current.next());
    expect(result.current).toMatchObject({ items: ["c", "d"], page: 2 });
  });

  it("hands useQueries the same request while nothing changes, though `api.*` gives a new reference each read", () => {
    // useQueries subscribes again for every new request object, which re-renders without end.
    const { rerender } = renderHook(() => useCursorPage({ name: "collections:list" } as unknown as typeof query, {}, 2));
    rerender();
    rerender();
    expect(new Set(server.requests).size).toBe(1);
  });

  it("reads a filled page again when rows added to an earlier read push it past its size", () => {
    server.pages.set("|null", page(["a"], "s1"));
    server.pages.set("|s1", page(["b"], "c1"));
    const { result, rerender } = renderHook(() => useCursorPage(query, {}, 2));
    expect(result.current.items).toEqual(["a", "b"]);
    // A match appears in the first read's range: three rows, and a fresh read of the page.
    server.pages.set("|null", page(["a", "a2"], "s1b"));
    server.pages.set("|null|1", page(["a", "a2"], "c0"));
    rerender();
    expect(result.current.items).toEqual(["a", "a2"]);
    act(() => result.current.next());
    expect(server.reads.at(-1)?.paginationOpts.cursor).toBe("c0");
  });
});
