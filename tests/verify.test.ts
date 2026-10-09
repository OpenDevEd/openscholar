import { describe, expect, it } from "vitest";
import { analyzePhase, knownAfterLooks, matchKnown, stopDecision, type Frame, type Item } from "../scripts/verify/analysis.ts";

function frame(t: number, change: Partial<Frame> = {}): Frame {
  return { t, moved: [], added: [], removed: [], textAdded: [], textRemoved: [], ...change };
}

describe("analyzePhase on a page load", () => {
  const load = { name: "load", kind: "load" as const, start: 0, baseline: 100 };

  it("reports content that moves after the page first settles", () => {
    const findings = analyzePhase(
      [frame(120), frame(800, { moved: [{ id: 7, dx: 0, dy: 240, dw: 0, dh: 0 }] })],
      load,
    );
    expect(findings).toEqual([{ kind: "shift", from: 800, to: 800, moves: [{ id: 7, dx: 0, dy: 240, dw: 0, dh: 0 }] }]);
  });

  it("ignores layout that settles before the baseline, such as a font swap", () => {
    const findings = analyzePhase([frame(40, { moved: [{ id: 3, dx: 2, dy: 0, dw: 4, dh: 0 }] })], load);
    expect(findings).toEqual([]);
  });

  it("joins the frames of one growing container into a single shift with the largest change", () => {
    const findings = analyzePhase(
      [
        frame(500, { moved: [{ id: 1, dx: 0, dy: 0, dw: 0, dh: 40 }] }),
        frame(516, { moved: [{ id: 1, dx: 0, dy: 0, dw: 0, dh: 80 }] }),
        frame(900, { moved: [{ id: 2, dx: 0, dy: 30, dw: 0, dh: 0 }] }),
      ],
      load,
    );
    expect(findings).toEqual([
      { kind: "shift", from: 500, to: 516, moves: [{ id: 1, dx: 0, dy: 0, dw: 0, dh: 120 }] },
      { kind: "shift", from: 900, to: 900, moves: [{ id: 2, dx: 0, dy: 30, dw: 0, dh: 0 }] },
    ]);
  });

  it("reports text that disappears and comes back, and text shown only for a moment", () => {
    const findings = analyzePhase(
      [
        frame(200, { textAdded: ["12 papers"] }),
        frame(400, { textRemoved: ["12 papers"], textAdded: ["Loading"] }),
        frame(600, { textAdded: ["12 papers"], textRemoved: ["Loading"] }),
      ],
      load,
    );
    expect(findings).toEqual([
      { kind: "brief-text", text: "Loading", from: 400, to: 600 },
      { kind: "text-flash", text: "12 papers", from: 400, to: 600 },
    ]);
  });

  it("reports a large element that is removed moments after it appears, but not a small one", () => {
    const findings = analyzePhase(
      [
        frame(300, { added: [{ id: 5, box: [0, 0, 200, 100] }, { id: 6, box: [0, 200, 10, 10] }] }),
        frame(450, { removed: [{ id: 5, box: [0, 0, 200, 100] }, { id: 6, box: [0, 200, 10, 10] }] }),
      ],
      load,
    );
    expect(findings).toEqual([{ kind: "brief-element", id: 5, from: 300, to: 450 }]);
  });

  it("accepts a placeholder that the real content replaces in the same place and size", () => {
    const findings = analyzePhase(
      [
        frame(300, { added: [{ id: 5, box: [0, 0, 256, 900] }] }),
        frame(450, { removed: [{ id: 5, box: [0, 0, 256, 900] }], added: [{ id: 8, box: [0, 0, 256, 900] }] }),
      ],
      load,
    );
    expect(findings).toEqual([]);
  });

  it("accepts rows added below existing content and text that stays", () => {
    const findings = analyzePhase(
      [frame(300, { added: [{ id: 9, box: [0, 400, 500, 100] }], textAdded: ["Row 1", "Row 2"] }), frame(2_000)],
      load,
    );
    expect(findings).toEqual([]);
  });
});

describe("analyzePhase after an action", () => {
  const step = { name: "click Save", kind: "step" as const, start: 1_000 };

  it("treats the first burst of change as the response and reports later movement", () => {
    const findings = analyzePhase(
      [
        frame(1_050, { added: [{ id: 20, box: [0, 100, 300, 300] }] }),
        frame(1_066, { moved: [{ id: 21, dx: 0, dy: 4, dw: 0, dh: 0 }] }),
        frame(1_700, { moved: [{ id: 20, dx: 0, dy: 0, dw: 0, dh: 160 }] }),
      ],
      step,
    );
    expect(findings).toEqual([{ kind: "shift", from: 1_700, to: 1_700, moves: [{ id: 20, dx: 0, dy: 0, dw: 0, dh: 160 }] }]);
  });

  it("accepts an action whose only effect is one animated burst", () => {
    const findings = analyzePhase(
      [
        frame(1_020, { moved: [{ id: 4, dx: 0, dy: 0, dw: 0, dh: 30 }] }),
        frame(1_036, { moved: [{ id: 4, dx: 0, dy: 0, dw: 0, dh: 30 }] }),
        frame(1_052, { moved: [{ id: 4, dx: 0, dy: 0, dw: 0, dh: 30 }] }),
      ],
      step,
    );
    expect(findings).toEqual([]);
  });

  it("ignores frames recorded before the action started", () => {
    const findings = analyzePhase([frame(900, { moved: [{ id: 1, dx: 0, dy: 50, dw: 0, dh: 0 }] })], step);
    expect(findings).toEqual([]);
  });
});

describe("stopDecision", () => {
  const sessionStartMs = 1_000;

  it("lets the agent stop when no user-facing file changed", () => {
    expect(
      stopDecision({ stopHookActive: false, sessionStartMs, lastPassMs: null, changed: [{ path: "convex/papers.ts", mtimeMs: 5_000 }, { path: "app/api/health/route.ts", mtimeMs: 5_000 }] }),
    ).toEqual({ block: false });
  });

  it("blocks when a page or style changed in this session and nothing verified it", () => {
    expect(
      stopDecision({ stopHookActive: false, sessionStartMs, lastPassMs: null, changed: [{ path: "components/search/bar.tsx", mtimeMs: 5_000 }, { path: "app/globals.css", mtimeMs: 6_000 }] }),
    ).toEqual({ block: true, files: ["components/search/bar.tsx", "app/globals.css"] });
  });

  it("ignores user-facing files changed before this session started", () => {
    expect(
      stopDecision({ stopHookActive: false, sessionStartMs, lastPassMs: null, changed: [{ path: "components/search/bar.tsx", mtimeMs: 500 }] }),
    ).toEqual({ block: false });
  });

  it("lets the agent stop once a verify pass is newer than every change", () => {
    expect(
      stopDecision({ stopHookActive: false, sessionStartMs, lastPassMs: 7_000, changed: [{ path: "components/search/bar.tsx", mtimeMs: 5_000 }] }),
    ).toEqual({ block: false });
  });

  it("blocks again when a file changed after the last verify pass", () => {
    expect(
      stopDecision({ stopHookActive: false, sessionStartMs, lastPassMs: 7_000, changed: [{ path: "components/search/bar.tsx", mtimeMs: 5_000 }, { path: "components/search/chip.tsx", mtimeMs: 8_000 }] }),
    ).toEqual({ block: true, files: ["components/search/chip.tsx"] });
  });

  it("never blocks twice in a row, so a broken environment cannot trap the agent", () => {
    expect(
      stopDecision({ stopHookActive: true, sessionStartMs, lastPassMs: null, changed: [{ path: "components/search/bar.tsx", mtimeMs: 5_000 }] }),
    ).toEqual({ block: false });
  });
});

describe("matchKnown", () => {
  const item = (kind: string, keys: string[]): Item => ({ kind, keys, line: kind });

  it("matches a shift that dev also has, even when dev lists more of the elements it moves", () => {
    const local = [item("shift", ["filter", "sort"])];
    const base = [item("shift", ["filter", "sort", "footer"])];
    expect(matchKnown(local, base)).toEqual([true]);
  });

  it("reports a shift as new when it moves an element that never moves on dev, even inside a burst dev also has", () => {
    const local = [item("shift", ["sidebar", "nav", "results"])];
    const base = [item("shift", ["sidebar", "nav"])];
    expect(matchKnown(local, base)).toEqual([false]);
  });

  it("keeps an extra shift new even when it moves elements that already shift on dev", () => {
    const local = [item("shift", ["filter", "footer"]), item("shift", ["sort", "footer"])];
    const base = [item("shift", ["filter", "sort", "footer"])];
    expect(matchKnown(local, base)).toEqual([true, false]);
  });

  it("does not match a shift whose elements are mostly different", () => {
    expect(matchKnown([item("shift", ["banner", "card", "footer"])], [item("shift", ["footer", "nav"])])).toEqual([false]);
  });

  it("matches flashes and errors only by the same kind and text", () => {
    const local = [item("text-flash", ["12 papers"]), item("error", ["boom"]), item("brief-text", ["12 papers"])];
    const base = [item("text-flash", ["12 papers"]), item("error", ["other"])];
    expect(matchKnown(local, base)).toEqual([true, false, false]);
  });
});

describe("knownAfterLooks", () => {
  const item = (kind: string, keys: string[]): Item => ({ kind, keys, line: kind });

  it("never adds two looks together, so a second jump stays new when dev has one", () => {
    const local = [item("shift", ["filter", "footer"]), item("shift", ["filter", "footer"])];
    const look = [item("shift", ["filter", "footer"])];
    expect(knownAfterLooks(local, [look, look])).toEqual([true, false]);
  });

  it("takes the look that saw the problem when the other one missed it", () => {
    const local = [item("shift", ["filter", "footer"])];
    expect(knownAfterLooks(local, [[], [item("shift", ["filter", "footer"])]])).toEqual([true]);
  });
});
