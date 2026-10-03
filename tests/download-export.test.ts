// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConvexReactClient } from "convex/react";
import { downloadExport } from "@/lib/export";

type Progress = { part: number; serving: boolean; failed: boolean } | null;

/** A client whose export progress the test sets, notifying the watcher as Convex would. */
function client() {
  let progress: Progress | undefined;
  let listener = () => {};
  let watching = () => {};
  const watched = new Promise<void>((resolve) => (watching = resolve));
  const convex = {
    mutation: vi.fn().mockResolvedValue(null),
    watchQuery: () => ({ localQueryResult: () => progress, onUpdate: (callback: () => void) => ((listener = callback), watching(), () => {}) }),
  } as unknown as ConvexReactClient;
  return { convex, watched, set: (next: Progress) => ((progress = next), listener()) };
}

const frames = () => [...document.querySelectorAll("iframe")].map((frame) => new URL(frame.src).searchParams.get("part"));
const source = { kind: "history" as const };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("downloadExport", () => {
  it("opens each part as the one before it finishes, and settles when the last is done", async () => {
    const { convex, watched, set } = client();
    const done = downloadExport(convex, source, "csv");
    await watched;
    set({ part: 1, serving: false, failed: false });
    set({ part: 1, serving: true, failed: false });
    set({ part: 2, serving: false, failed: false });
    expect(frames()).toEqual(["1", "2"]);
    set(null);
    await expect(done).resolves.toBeUndefined();
  });

  it("fails when a part fails on the server", async () => {
    const { convex, watched, set } = client();
    const done = downloadExport(convex, source, "json");
    await watched;
    set({ part: 1, serving: false, failed: false });
    set({ part: 1, serving: false, failed: true });
    await expect(done).rejects.toThrow(/failed/);
  });

  it("fails when a part it opened never starts", async () => {
    const { convex, watched, set } = client();
    const done = downloadExport(convex, source, "csv");
    const failed = expect(done).rejects.toThrow(/didn't start/);
    await watched;
    set({ part: 1, serving: false, failed: false });
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
  });
});
