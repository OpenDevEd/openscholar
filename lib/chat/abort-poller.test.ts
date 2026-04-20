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
});
