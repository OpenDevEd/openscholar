import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";

type Page = { page: string[]; isDone: boolean; continueCursor: string };
type Args = { search?: string; paginationOpts: { cursor: string | null; numItems: number } };

// What the server holds, by search then start cursor; a page missing from it is still loading.
const server = vi.hoisted(() => ({ pages: new Map<string, Page>() }));
vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (_query: unknown, args: Args | "skip") =>
    ({ data: args === "skip" ? undefined : server.pages.get(`${args.search ?? ""}|${args.paginationOpts.cursor}`) }),
}));

const query = "collections:list" as unknown as FunctionReference<"query", "public", Args, Page>;
const page = (items: string[], continueCursor: string, isDone = false): Page => ({ page: items, isDone, continueCursor });

beforeEach(() => {
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
});
