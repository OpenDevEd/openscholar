// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import {
  useTransactionsLoadMore,
  type PaginatedStatus,
} from "@/components/billing/transactions/use-transactions-load-more";

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void;

interface MockInstance {
  callback: ObserverCallback;
  init: IntersectionObserverInit | undefined;
  observed: Element[];
  disconnected: boolean;
  observe: (el: Element) => void;
  disconnect: () => void;
  unobserve: (el: Element) => void;
  trigger: (isIntersecting: boolean) => void;
}

let mockInstances: MockInstance[] = [];

class MockIntersectionObserver implements IntersectionObserver {
  readonly callback: ObserverCallback;
  readonly init: IntersectionObserverInit | undefined;
  readonly observed: Element[] = [];
  disconnected = false;
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [0];

  constructor(callback: ObserverCallback, init?: IntersectionObserverInit) {
    this.callback = callback;
    this.init = init;
    const self: MockInstance = {
      callback,
      init,
      observed: this.observed,
      disconnected: false,
      observe: (el) => {
        this.observed.push(el);
      },
      disconnect: () => {
        this.disconnected = true;
        self.disconnected = true;
      },
      unobserve: () => {},
      trigger: (isIntersecting) => {
        self.callback(
          self.observed.map(
            (target) =>
              ({
                isIntersecting,
                target,
                time: 0,
                boundingClientRect: {} as DOMRectReadOnly,
                intersectionRatio: isIntersecting ? 1 : 0,
                intersectionRect: {} as DOMRectReadOnly,
                rootBounds: null,
              }) as IntersectionObserverEntry,
          ),
        );
      },
    };
    mockInstances.push(self);
  }

  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
    mockInstances[mockInstances.length - 1].disconnected = true;
  }
  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function mkRef<T extends HTMLElement>(tag: string): React.RefObject<T | null> {
  const el = document.createElement(tag) as T;
  const ref = createRef<T | null>() as { current: T | null };
  ref.current = el;
  return ref as React.RefObject<T | null>;
}

describe("useTransactionsLoadMore", () => {
  beforeEach(() => {
    mockInstances = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not observe while status is LoadingFirstPage", () => {
    const sentinelRef = mkRef<HTMLDivElement>("div");
    const scrollRef = mkRef<HTMLDivElement>("div");
    const loadMore = vi.fn();
    renderHook(() =>
      useTransactionsLoadMore({
        sentinelRef,
        scrollRef,
        status: "LoadingFirstPage",
        loadMore,
      }),
    );
    expect(mockInstances).toHaveLength(0);
  });

  it("does not observe while status is LoadingMore, Exhausted, or Deferred", () => {
    const sentinelRef = mkRef<HTMLDivElement>("div");
    const scrollRef = mkRef<HTMLDivElement>("div");
    const loadMore = vi.fn();
    for (const status of ["LoadingMore", "Exhausted", "Deferred"] as const) {
      const { unmount } = renderHook(() =>
        useTransactionsLoadMore({
          sentinelRef,
          scrollRef,
          status: status as PaginatedStatus,
          loadMore,
        }),
      );
      unmount();
    }
    expect(mockInstances).toHaveLength(0);
  });

  it("creates an observer rooted at scrollRef with rootMargin 0px 0px 400px 0px when status is CanLoadMore", () => {
    const sentinelRef = mkRef<HTMLDivElement>("div");
    const scrollRef = mkRef<HTMLDivElement>("div");
    const loadMore = vi.fn();
    renderHook(() =>
      useTransactionsLoadMore({
        sentinelRef,
        scrollRef,
        status: "CanLoadMore",
        loadMore,
      }),
    );
    expect(mockInstances).toHaveLength(1);
    expect(mockInstances[0].init?.root).toBe(scrollRef.current);
    expect(mockInstances[0].init?.rootMargin).toBe("0px 0px 400px 0px");
    expect(mockInstances[0].init?.threshold).toBe(0);
    expect(mockInstances[0].observed).toHaveLength(1);
    expect(mockInstances[0].observed[0]).toBe(sentinelRef.current);
  });

  it("calls loadMore with the batch size when the sentinel becomes intersecting", () => {
    const sentinelRef = mkRef<HTMLDivElement>("div");
    const scrollRef = mkRef<HTMLDivElement>("div");
    const loadMore = vi.fn();
    renderHook(() =>
      useTransactionsLoadMore({
        sentinelRef,
        scrollRef,
        status: "CanLoadMore",
        loadMore,
        batchSize: 25,
      }),
    );
    mockInstances[0].trigger(true);
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(loadMore).toHaveBeenCalledWith(25);
  });

  it("does not call loadMore when the sentinel is not intersecting", () => {
    const sentinelRef = mkRef<HTMLDivElement>("div");
    const scrollRef = mkRef<HTMLDivElement>("div");
    const loadMore = vi.fn();
    renderHook(() =>
      useTransactionsLoadMore({
        sentinelRef,
        scrollRef,
        status: "CanLoadMore",
        loadMore,
      }),
    );
    mockInstances[0].trigger(false);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it("disconnects the observer on unmount", () => {
    const sentinelRef = mkRef<HTMLDivElement>("div");
    const scrollRef = mkRef<HTMLDivElement>("div");
    const loadMore = vi.fn();
    const { unmount } = renderHook(() =>
      useTransactionsLoadMore({
        sentinelRef,
        scrollRef,
        status: "CanLoadMore",
        loadMore,
      }),
    );
    expect(mockInstances[0].disconnected).toBe(false);
    unmount();
    expect(mockInstances[0].disconnected).toBe(true);
  });

  it("disconnects and re-creates on status change", () => {
    const sentinelRef = mkRef<HTMLDivElement>("div");
    const scrollRef = mkRef<HTMLDivElement>("div");
    const loadMore = vi.fn();
    const { rerender } = renderHook(
      ({ status }: { status: PaginatedStatus }) =>
        useTransactionsLoadMore({
          sentinelRef,
          scrollRef,
          status,
          loadMore,
        }),
      { initialProps: { status: "CanLoadMore" as PaginatedStatus } },
    );
    expect(mockInstances).toHaveLength(1);
    rerender({ status: "LoadingMore" });
    expect(mockInstances[0].disconnected).toBe(true);
    expect(mockInstances).toHaveLength(1);
  });

  it("honors a custom rootMargin", () => {
    const sentinelRef = mkRef<HTMLDivElement>("div");
    const scrollRef = mkRef<HTMLDivElement>("div");
    const loadMore = vi.fn();
    renderHook(() =>
      useTransactionsLoadMore({
        sentinelRef,
        scrollRef,
        status: "CanLoadMore",
        loadMore,
        rootMargin: "0px 0px 200px 0px",
      }),
    );
    expect(mockInstances[0].init?.rootMargin).toBe("0px 0px 200px 0px");
  });
});
