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
});
