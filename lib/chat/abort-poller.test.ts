import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startAbortPoller } from "./abort-poller";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startAbortPoller", () => {
  it("returns a function", () => {
    const stop = startAbortPoller({
      readFlag: async () => false,
      onAbort: () => {},
    });
    expect(typeof stop).toBe("function");
    stop();
  });

  it("stop() clears the interval — readFlag never called after stop", async () => {
    const readFlag = vi.fn(async () => false);
    const stop = startAbortPoller({ readFlag, onAbort: () => {} });
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(readFlag).not.toHaveBeenCalled();
  });

  it("fires onAbort when readFlag transitions to true", async () => {
    const replies = [false, false, true, false, false];
    let i = 0;
    const readFlag = vi.fn(async () => replies[i++] ?? false);
    const onAbort = vi.fn();
    const stop = startAbortPoller({ readFlag, onAbort, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(300);
    expect(onAbort).toHaveBeenCalledTimes(1);
    stop();
  });

  it("fires onAbort at most once even when readFlag stays true", async () => {
    const readFlag = vi.fn(async () => true);
    const onAbort = vi.fn();
    const stop = startAbortPoller({ readFlag, onAbort, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onAbort).toHaveBeenCalledTimes(1);
    stop();
  });

  it("never fires onAbort after stop(), even if a readFlag was in-flight", async () => {
    // Hold the first readFlag pending so we can call stop() while the
    // would-be-true result sits in the microtask queue.
    let resolveFirst!: (value: boolean) => void;
    const pending = new Promise<boolean>((r) => {
      resolveFirst = r;
    });
    const readFlag = vi.fn(() => pending);
    const onAbort = vi.fn();
    const stop = startAbortPoller({ readFlag, onAbort, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(100); // tick fires, readFlag hangs.
    stop();
    resolveFirst(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onAbort).not.toHaveBeenCalled();
  });

  it("swallows readFlag errors — keeps polling, never fires onAbort spuriously", async () => {
    let i = 0;
    const readFlag = vi.fn(async () => {
      i++;
      if (i <= 2) throw new Error("boom");
      return false;
    });
    const onAbort = vi.fn();
    const stop = startAbortPoller({ readFlag, onAbort, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(500);
    expect(readFlag.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(onAbort).not.toHaveBeenCalled();
    stop();
  });

  it("does not start a second read while the prior read is still pending", async () => {
    let resolveRead!: (value: boolean) => void;
    const pendingRead = new Promise<boolean>((resolve) => {
      resolveRead = resolve;
    });
    const readFlag = vi.fn(() => pendingRead);
    const onAbort = vi.fn();
    const stop = startAbortPoller({ readFlag, onAbort, intervalMs: 100 });

    await vi.advanceTimersByTimeAsync(500);
    expect(readFlag).toHaveBeenCalledTimes(1);

    resolveRead(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(readFlag).toHaveBeenCalledTimes(2);
    expect(onAbort).not.toHaveBeenCalled();
    stop();
  });

  it("defaults intervalMs to 500", async () => {
    const readFlag = vi.fn(async () => false);
    const stop = startAbortPoller({ readFlag, onAbort: () => {} });
    await vi.advanceTimersByTimeAsync(499);
    expect(readFlag).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(readFlag).toHaveBeenCalledTimes(1);
    stop();
  });

  it("honors a custom intervalMs", async () => {
    const readFlag = vi.fn(async () => false);
    const stop = startAbortPoller({
      readFlag,
      onAbort: () => {},
      intervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(readFlag).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(readFlag).toHaveBeenCalledTimes(1);
    stop();
  });
});
