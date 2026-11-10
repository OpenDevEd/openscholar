import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { useCursorPage, useCursorPageAt } from "@/lib/hooks/use-cursor-page";

type Page = { page: string[]; isDone: boolean; continueCursor: string };
type Args = { search?: string; paginationOpts: { cursor: string | null; numItems: number; id?: number } };

// What the server holds, by search then start cursor; a page missing from it is still loading.
const server = vi.hoisted(() => ({ pages: new Map<string, Page | Error>(), reads: [] as Args[], requests: [] as unknown[] }));
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

  it("stays on the first page when its arguments change back", () => {
    const { result, rerender } = renderHook(({ search }) => useCursorPage(query, { search }, 2), { initialProps: { search: undefined as string | undefined } });
    act(() => result.current.next());
    rerender({ search: "x" });
    rerender({ search: undefined });
    expect(result.current).toMatchObject({ items: ["a", "b"], page: 1, canPrevious: false });
  });

  it("starts over from the first page when the page size changes", () => {
    const { result, rerender } = renderHook(({ size }) => useCursorPage(query, {}, size), { initialProps: { size: 2 } });
    act(() => result.current.next());
    expect(result.current).toMatchObject({ items: ["c", "d"], page: 2 });
    server.pages.set("|null", page(["a"], "c0"));
    rerender({ size: 1 });
    expect(result.current).toMatchObject({ items: ["a"], page: 1, canPrevious: false, offset: 0 });
    expect(server.reads.at(-1)?.paginationOpts).toMatchObject({ cursor: null, numItems: 1 });
  });

  it("steps back from a page its rows were all deleted from", () => {
    const { result, rerender } = renderHook(() => useCursorPage(query, {}, 2));
    act(() => result.current.next());
    server.pages.set("|c1", page([], "c2", true));
    rerender();
    expect(result.current).toMatchObject({ items: ["a", "b"], page: 1, canPrevious: false });
  });

  it("stops offering next on a full last page once the page after it came back empty", () => {
    // The list ends exactly on a full page, which the server can't tell until it reads past it.
    server.pages.set("|c1", page(["c", "d"], "c2"));
    server.pages.set("|c2", page([], "", true));
    const { result } = renderHook(() => useCursorPage(query, {}, 2));
    act(() => result.current.next());
    expect(result.current).toMatchObject({ items: ["c", "d"], page: 2, canNext: true });
    act(() => result.current.next());
    expect(result.current).toMatchObject({ items: ["c", "d"], page: 2, canNext: false, canPrevious: true });
    act(() => result.current.previous());
    expect(result.current).toMatchObject({ items: ["a", "b"], page: 1, canNext: true });
  });

  it("offers next again on the last page once a row is added after it", () => {
    server.pages.set("|c1", page(["c", "d"], "c2"));
    server.pages.set("|c2", page([], "", true));
    const { result, rerender } = renderHook(() => useCursorPage(query, {}, 2));
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current).toMatchObject({ page: 2, canNext: false });
    server.pages.set("|c2", page(["e"], "c3", true));
    rerender();
    expect(result.current).toMatchObject({ items: ["c", "d"], page: 2, canNext: true });
    act(() => result.current.next());
    expect(result.current).toMatchObject({ items: ["e"], page: 3, canNext: false });
  });

  it("reads a page again from its start when an earlier read no longer stops where the next one starts", () => {
    // A filtered read stops after a set number of rows; a row deleted inside it moves that stop one row on.
    server.pages.set("|null", page(["a"], "s1"));
    server.pages.set("|s1", page(["b"], "c1"));
    const { result, rerender } = renderHook(() => useCursorPage(query, {}, 2));
    expect(result.current.items).toEqual(["a", "b"]);
    // The first read now reaches "b" as well, while the second still starts before it.
    server.pages.set("|null", page(["a"], "s1b"));
    server.pages.set("|null|1", page(["a", "b"], "c1"));
    rerender();
    expect(result.current.items).toEqual(["a", "b"]);
    expect(server.reads.at(-1)?.paginationOpts).toMatchObject({ cursor: null, id: 1 });
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

  it("counts the rows before a page from what earlier pages held, not their number", () => {
    // Five reads find one match, so page 1 stops short; page 2 starts after that one row.
    server.pages.set("|null", page(["a"], "e1"));
    for (let i = 1; i < 5; i++) server.pages.set(`|e${i}`, page([], `e${i + 1}`));
    server.pages.set("|e5", page(["b", "c"], "c9", true));
    const { result } = renderHook(() => useCursorPage(query, {}, 20));
    expect(result.current).toMatchObject({ items: ["a"], offset: 0, canNext: true });
    act(() => result.current.next());
    expect(result.current).toMatchObject({ items: ["b", "c"], page: 2, offset: 1 });
  });

  it("starts over from the first page when the server refuses a page's cursor, as it does once a deploy reads the list through another index", () => {
    const { result, rerender } = renderHook(() => useCursorPage(query, {}, 2));
    act(() => result.current.next());
    expect(result.current.page).toBe(2);
    server.pages.set("|c1", new Error("[CONVEX Q(collections:list)] InvalidCursor: Tried to run a query starting from a cursor, but it looks like this cursor is from a different query."));
    rerender();
    expect(result.current).toMatchObject({ items: ["a", "b"], page: 1, canPrevious: false });
  });

  it("starts over under a new query id when the server refuses the first page, whose subscription keeps where it ended", () => {
    server.pages.set("|null|0", new Error("[CONVEX Q(collections:list)] InvalidCursor: Tried to run a query starting from a cursor, but it looks like this cursor is from a different query."));
    const { result } = renderHook(() => useCursorPage(query, {}, 2));
    expect(result.current).toMatchObject({ items: ["a", "b"], page: 1, canNext: true });
  });

  it("starts over when the server refuses the read past the page the list ended on", () => {
    server.pages.set("|c1", page(["c", "d"], "c2"));
    server.pages.set("|c2", page([], "", true));
    const { result, rerender } = renderHook(() => useCursorPage(query, {}, 2));
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current).toMatchObject({ page: 2, canNext: false });
    server.pages.set("|c2", new Error("[CONVEX Q(collections:list)] InvalidCursor: Tried to run a query starting from a cursor, but it looks like this cursor is from a different query."));
    rerender();
    expect(result.current).toMatchObject({ items: ["a", "b"], page: 1, canNext: true });
  });
});

describe("useCursorPageAt", () => {
  const updates: UrlUpdateEvent[] = [];
  const at = (search = "") => ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={search} onUrlUpdate={(update) => updates.push(update)} hasMemory>{children}</NuqsTestingAdapter>
  );
  beforeEach(() => { updates.length = 0; });
  // nuqs writes the address a moment after the state; the full suite runs many workers, so allow it longer than a second.
  const written = async (count: number) => { await waitFor(() => expect(updates).toHaveLength(count), { timeout: 5000 }); return updates.at(-1)!; };
  /** The address after one step forward from the first page. */
  const second = async () => {
    const first = renderHook(() => useCursorPageAt("page", query, {}, 2), { wrapper: at() });
    act(() => first.result.current.next());
    const { queryString } = await written(1);
    first.unmount();
    return queryString;
  };

  it("writes each step to the address as a step in the browser's history, and the first page as no parameter", async () => {
    const { result } = renderHook(() => useCursorPageAt("page", query, {}, 2), { wrapper: at() });
    act(() => result.current.next());
    expect(result.current).toMatchObject({ items: ["c", "d"], page: 2 });
    const forward = await written(1);
    expect(forward).toMatchObject({ options: { history: "push", scroll: true } });
    // The page's number and the list's name, and nothing of where the page starts: a cursor may hold a person's email.
    expect(forward.searchParams.get("page")).toMatch(/^2\.[a-z0-9]+$/);
    act(() => result.current.previous());
    expect(result.current).toMatchObject({ items: ["a", "b"], page: 1 });
    expect((await written(2)).searchParams.has("page")).toBe(false);
  });

  it("opens the page an address names, reading the pages before it to find where it starts", async () => {
    server.pages.set("|c1", page(["c", "d"], "c2"));
    server.pages.set("|c2", page(["e"], "c3", true));
    const address = (await second()).replace("page=2", "page=3");
    server.reads = [];
    const { result } = renderHook(() => useCursorPageAt("page", query, {}, 2), { wrapper: at(address) });
    expect(result.current).toMatchObject({ items: ["e"], page: 3, offset: 4, canPrevious: true, canNext: false, isStale: false });
    act(() => result.current.previous());
    expect(result.current).toMatchObject({ items: ["c", "d"], page: 2, offset: 2 });
  });

  it("shows nothing of the pages it reads on the way", async () => {
    const address = await second();
    server.pages.delete("|c1");
    const { result } = renderHook(() => useCursorPageAt("page", query, {}, 2), { wrapper: at(address) });
    expect(result.current).toMatchObject({ items: [], isLoading: true, page: 2 });
  });

  it("opens the last page when the address names one past the list's end", async () => {
    const address = (await second()).replace("page=2", "page=9");
    const { result, rerender } = renderHook(() => useCursorPageAt("page", query, {}, 2), { wrapper: at(address) });
    expect(result.current).toMatchObject({ items: ["c", "d"], page: 2, canNext: false });
    // Rows added after it: the page shown stays, and offers the next.
    server.pages.set("|c1", page(["c", "d"], "c2"));
    server.pages.set("|c2", page(["e"], "c3", true));
    rerender();
    expect(result.current).toMatchObject({ items: ["c", "d"], page: 2, canNext: true });
  });

  it("opens the first page when the address names a place in another search", async () => {
    const address = await second();
    const { result } = renderHook(() => useCursorPageAt("page", query, { search: "x" }, 2), { wrapper: at(address) });
    expect(result.current).toMatchObject({ items: ["x"], page: 1, canPrevious: false });
  });

  it("opens the first page for a second list that shares the parameter and takes the same arguments", async () => {
    const address = await second();
    const other = { name: "collections:others" } as unknown as typeof query;
    const { result } = renderHook(() => useCursorPageAt("page", other, {}, 2), { wrapper: at(address) });
    expect(result.current).toMatchObject({ items: ["a", "b"], page: 1, canPrevious: false });
  });

  it("goes back to a page it passed without reading the pages before it again", async () => {
    server.pages.set("|c1", page(["c", "d"], "c2"));
    server.pages.set("|c2", page(["e"], "c3", true));
    // The address the browser is at, which its Back button moves.
    const browser = { search: "" };
    const wrapper = ({ children }: { children: ReactNode }) => <NuqsTestingAdapter searchParams={browser.search} onUrlUpdate={(update) => updates.push(update)} hasMemory>{children}</NuqsTestingAdapter>;
    const { result, rerender } = renderHook(() => useCursorPageAt("page", query, {}, 2), { wrapper });
    act(() => result.current.next());
    const second = (await written(1)).queryString;
    act(() => result.current.next());
    await written(2);
    expect(result.current).toMatchObject({ items: ["e"], page: 3 });
    server.reads = [];
    browser.search = second;
    rerender();
    await waitFor(() => expect(result.current).toMatchObject({ items: ["c", "d"], page: 2 }), { timeout: 5000 });
    expect(server.reads.map((read) => read.paginationOpts.cursor)).not.toContain(null);
  });

  it("leaves the page where it is for a list that is one part of a long page", async () => {
    const { result } = renderHook(() => useCursorPageAt("limits", query, {}, 2, { scroll: false }), { wrapper: at() });
    act(() => result.current.next());
    expect(await written(1)).toMatchObject({ options: { history: "push", scroll: false } });
  });
});
