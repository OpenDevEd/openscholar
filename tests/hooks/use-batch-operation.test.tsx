/**
 * @vitest-environment jsdom
 *
 * plan-05 — covers two coupled behaviors of `useBatchOperation`:
 *   1. queuedLoadingBatchKeyRef — when K2's batchKey arrives while K1 is
 *      still in-flight, K2's loading state is set exactly once and not
 *      re-set on subsequent same-K2 rerenders.
 *   2. settledBatchVersion — when K1 finishes, the effect re-runs and
 *      starts K2 without needing any other dep change. Without the bump,
 *      a queued K2 with stable papers/context would never fire.
 *
 * `useBatchOperation` only imports React, so it can be tested directly
 * with no module mocking. All config callbacks are module-level so
 * their identity is stable across renders (mirroring how the real
 * consumer hooks wrap them in `useCallback`).
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useBatchOperation } from "@/hooks/use-batch-operation";

interface Paper {
  id: string;
  title?: string;
  abstract?: string;
}
type Result = { value: string };
type Ctx = { id: string };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const computeBatchKey = (ps: Paper[]): string | null =>
  ps.length === 0 ? null : ps.map((p) => p.id).sort().join(",");
const filterItemsNeedingProcessing = (ps: Paper[]) => ps;
const buildExecuteInput = (ps: Paper[]) => ({ ids: ps.map((p) => p.id) });
const handleResult = () => {};
const createLoadingState = (ps: Paper[]) => new Set(ps.map((p) => p.id));
const clearLoadingState = () => new Set<string>();
const STABLE_CONTEXT: Ctx = { id: "ctx" };

interface HarnessProps {
  papers: Paper[];
  execute: ReturnType<typeof vi.fn>;
}

function useHarness({ papers, execute }: HarnessProps) {
  return useBatchOperation<{ ids: string[] }, Result, Ctx, Set<string>>({
    execute,
    isConfigured: true,
    computeBatchKey,
    filterItemsNeedingProcessing,
    buildExecuteInput,
    handleResult,
    contextId: "ctx",
    context: STABLE_CONTEXT,
    canStart: true,
    papers,
    createLoadingState,
    clearLoadingState,
  });
}

describe("useBatchOperation — queued loading + settledBatchVersion", () => {
  it("starts the queued K2 after K1 settles (settledBatchVersion bump)", async () => {
    const k1 = deferred<{ results: Record<string, Result>; errors: never[] }>();
    const k2 = deferred<{ results: Record<string, Result>; errors: never[] }>();
    const execute = vi
      .fn()
      .mockImplementationOnce(() => k1.promise)
      .mockImplementationOnce(() => k2.promise);

    const { result, rerender } = renderHook((p) => useHarness(p), {
      initialProps: { papers: [{ id: "p1" }], execute } as HarnessProps,
    });

    // K1 fired immediately — loading reflects p1.
    await waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    expect(result.current.loadingState.has("p1")).toBe(true);

    // Re-render with K2's papers while K1 is still pending. The hook
    // should NOT fire execute again (still in-flight) but should surface
    // K2's loading state (queued).
    rerender({ papers: [{ id: "p2" }], execute } as HarnessProps);
    await act(async () => {
      await Promise.resolve();
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.current.loadingState.has("p2")).toBe(true);

    // Resolve K1. The settledBatchVersion bump forces the effect to
    // re-run; K2 fires, no other dep change needed.
    await act(async () => {
      k1.resolve({ results: { p1: { value: "v1" } }, errors: [] });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      k2.resolve({ results: { p2: { value: "v2" } }, errors: [] });
      await Promise.resolve();
    });
  });

  it("dedups loading-state writes for a queued K2 across same-batchKey rerenders", async () => {
    const k1 = deferred<{ results: Record<string, Result>; errors: never[] }>();
    const k2 = deferred<{ results: Record<string, Result>; errors: never[] }>();
    const execute = vi
      .fn()
      .mockImplementationOnce(() => k1.promise)
      .mockImplementationOnce(() => k2.promise);

    const { result, rerender } = renderHook((p) => useHarness(p), {
      initialProps: { papers: [{ id: "p1" }], execute } as HarnessProps,
    });

    await waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });

    // K2 enters the queue: papers=[p2]. Loading set to {p2}.
    rerender({ papers: [{ id: "p2" }], execute } as HarnessProps);
    await act(async () => {
      await Promise.resolve();
    });
    const loadingAfterFirstQueue = result.current.loadingState;
    expect(loadingAfterFirstQueue.has("p2")).toBe(true);

    // Same K2 re-render — loadingState identity must NOT change because
    // the dedup branch should short-circuit before setLoadingState fires.
    rerender({ papers: [{ id: "p2" }], execute } as HarnessProps);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loadingState).toBe(loadingAfterFirstQueue);

    // Settle both batches so React doesn't complain about pending work.
    await act(async () => {
      k1.resolve({ results: {}, errors: [] });
      await Promise.resolve();
    });
    await act(async () => {
      k2.resolve({ results: {}, errors: [] });
      await Promise.resolve();
    });
  });
});
