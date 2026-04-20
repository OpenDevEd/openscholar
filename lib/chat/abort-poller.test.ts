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
});
