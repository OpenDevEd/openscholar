import { describe, expect, it } from "vitest";
import { reloadDue, RELOAD_GUARD_MS } from "./chunk-reload";

const chunkFailure = Object.assign(new Error("Failed to load chunk"), { name: "ChunkLoadError" });
const NOW = 1_800_000_000_000;

describe("reloadDue", () => {
  it("reloads for a missing chunk when no reload was tried in this tab", () => {
    expect(reloadDue(chunkFailure, true, null, NOW)).toBe(true);
  });

  it("leaves any other error to the error page", () => {
    expect(reloadDue(new TypeError("x is undefined"), true, null, NOW)).toBe(false);
    expect(reloadDue("ChunkLoadError", true, null, NOW)).toBe(false);
  });

  it("doesn't reload again while the chunk is still missing after a reload, so a page can't loop", () => {
    expect(reloadDue(chunkFailure, true, String(NOW - RELOAD_GUARD_MS + 1), NOW)).toBe(false);
  });

  it("reloads for a later deploy's missing chunk once the guard has passed", () => {
    expect(reloadDue(chunkFailure, true, String(NOW - RELOAD_GUARD_MS), NOW)).toBe(true);
  });

  it("doesn't reload offline, which would swap the app for the browser's offline page", () => {
    expect(reloadDue(chunkFailure, false, null, NOW)).toBe(false);
  });
});
