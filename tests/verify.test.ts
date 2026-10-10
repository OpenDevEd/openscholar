import { describe, expect, it } from "vitest";
import { analyzePhase, knownAfterLooks, matchKnown, stopDecision, type Frame, type Item } from "../scripts/verify/analysis.ts";
import { parseStep } from "../scripts/verify/browser.ts";

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

  const fontSwap = { moved: [{ id: 3, dx: -11, dy: 0, dw: 6, dh: 0 }] };

  it("reports text that its web font moves after the first paint, before the page has finished loading", () => {
    const findings = analyzePhase([frame(70, fontSwap)], { ...load, painted: 60 });
    expect(findings).toEqual([{ kind: "reflow", from: 70, to: 70, moves: fontSwap.moved }]);
  });

  it("keeps that early reflow apart from a shift that follows the baseline closely, so both look the same on every run", () => {
    const pushed = { moved: [{ id: 3, dx: 0, dy: 40, dw: 0, dh: 0 }] };
    const findings = analyzePhase([frame(70, fontSwap), frame(110, pushed)], { ...load, painted: 60 });
    expect(findings).toEqual([
      { kind: "reflow", from: 70, to: 70, moves: fontSwap.moved },
      { kind: "shift", from: 110, to: 110, moves: pushed.moved },
    ]);
  });

  it("ignores layout before the first paint, which nobody saw", () => {
    expect(analyzePhase([frame(40, fontSwap)], { ...load, painted: 60 })).toEqual([]);
    expect(analyzePhase([frame(40, fontSwap)], load)).toEqual([]);
  });

  it("ignores what moves before the baseline as new content arrives, since the page is still filling in", () => {
    const arriving = { moved: [{ id: 9, dx: 0, dy: 6301, dw: 0, dh: 0 }], added: [{ id: 12, box: [0, 80, 1440, 6301] as [number, number, number, number] }] };
    expect(analyzePhase([frame(70, arriving)], { ...load, painted: 60 })).toEqual([]);
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

  it("accepts a number that counts up in place, since the line keeps its words", () => {
    const findings = analyzePhase(
      [
        frame(400, { textAdded: ["Up to 4 credits"] }),
        frame(416, { textRemoved: ["Up to 4 credits"], textAdded: ["Up to 126 credits"] }),
        frame(432, { textRemoved: ["Up to 126 credits"], textAdded: ["Up to 1,250 credits"] }),
      ],
      load,
    );
    expect(findings).toEqual([]);
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
  const userFacing = /^((app|components)\/.+\.(tsx|css)|components\/.+\.ts)$/;

  it("counts .ts modules beside components, such as shared field styles", () => {
    expect(
      stopDecision({ userFacing, stopHookActive: false, sessionStartMs, lastPassMs: null, changed: [{ path: "components/ui/field-styles.ts", mtimeMs: 5_000 }] }),
    ).toEqual({ block: true, files: ["components/ui/field-styles.ts"] });
  });

  it("lets the agent stop when no user-facing file changed", () => {
    expect(
      stopDecision({ userFacing, stopHookActive: false, sessionStartMs, lastPassMs: null, changed: [{ path: "convex/papers.ts", mtimeMs: 5_000 }, { path: "app/api/health/route.ts", mtimeMs: 5_000 }] }),
    ).toEqual({ block: false });
  });

  it("blocks when a page or style changed in this session and nothing verified it", () => {
    expect(
      stopDecision({ userFacing, stopHookActive: false, sessionStartMs, lastPassMs: null, changed: [{ path: "components/search/bar.tsx", mtimeMs: 5_000 }, { path: "app/globals.css", mtimeMs: 6_000 }] }),
    ).toEqual({ block: true, files: ["components/search/bar.tsx", "app/globals.css"] });
  });

  it("ignores user-facing files changed before this session started", () => {
    expect(
      stopDecision({ userFacing, stopHookActive: false, sessionStartMs, lastPassMs: null, changed: [{ path: "components/search/bar.tsx", mtimeMs: 500 }] }),
    ).toEqual({ block: false });
  });

  it("lets the agent stop once a verify pass is newer than every change", () => {
    expect(
      stopDecision({ userFacing, stopHookActive: false, sessionStartMs, lastPassMs: 7_000, changed: [{ path: "components/search/bar.tsx", mtimeMs: 5_000 }] }),
    ).toEqual({ block: false });
  });

  it("blocks again when a file changed after the last verify pass", () => {
    expect(
      stopDecision({ userFacing, stopHookActive: false, sessionStartMs, lastPassMs: 7_000, changed: [{ path: "components/search/bar.tsx", mtimeMs: 5_000 }, { path: "components/search/chip.tsx", mtimeMs: 8_000 }] }),
    ).toEqual({ block: true, files: ["components/search/chip.tsx"] });
  });

  it("never blocks twice in a row, so a broken environment cannot trap the agent", () => {
    expect(
      stopDecision({ userFacing, stopHookActive: true, sessionStartMs, lastPassMs: null, changed: [{ path: "components/search/bar.tsx", mtimeMs: 5_000 }] }),
    ).toEqual({ block: false });
  });
});

describe("matchKnown", () => {
  const item = (kind: string, keys: string[]): Item => ({ kind, keys, line: kind });

  it("never lets an early reflow there vouch for a shift here: one move there is not two here", () => {
    const local = [item("reflow", ["nav"]), item("shift", ["nav"])];
    const base = [item("shift", ["nav"]), item("reflow", ["nav"])];
    expect(matchKnown(local, base)).toEqual([true, true]);
    expect(matchKnown([item("shift", ["nav"]), item("shift", ["nav"])], base)).toEqual([true, false]);
  });

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

  it("counts repeated elements, so two identical cards moving here are new when dev moves one", () => {
    expect(matchKnown([item("shift", ["card", "card"])], [item("shift", ["card"])])).toEqual([false]);
  });

  it("matches repeated elements that dev moves as many times", () => {
    expect(matchKnown([item("shift", ["card", "card"])], [item("shift", ["card", "card", "footer"])])).toEqual([true]);
  });

  it("matches an element's move that dev makes inside a bigger jump, when it moves the same way by about as much", () => {
    const move = (dh: number, dy = 0) => ({ dx: 0, dy, dw: 0, dh });
    const base = [{ ...item("shift", ["results", "thumb", "footer"]), deltas: [move(0, 856), move(-5), move(0, 856)] }];
    expect(matchKnown([{ ...item("shift", ["thumb"]), deltas: [move(-5)] }], base)).toEqual([true]);
    expect(matchKnown([{ ...item("shift", ["thumb"]), deltas: [move(5)] }], base)).toEqual([false]);
    expect(matchKnown([{ ...item("shift", ["footer"]), deltas: [move(0, 120)] }], base)).toEqual([false]);
    expect(matchKnown([{ ...item("shift", ["footer"]), deltas: [move(0, 850)] }], base)).toEqual([true]);
  });

  it("matches an element's sides one by one, so one move there can account for two that landed in different frames here", () => {
    const base = [{ ...item("shift", ["row"]), deltas: [{ dx: 0, dy: 72, dw: 0, dh: -16 }] }];
    const local = [
      { ...item("shift", ["row"]), deltas: [{ dx: 0, dy: 72, dw: 0, dh: 0 }] },
      { ...item("shift", ["row"]), deltas: [{ dx: 0, dy: 0, dw: 0, dh: -16 }] },
      { ...item("shift", ["row"]), deltas: [{ dx: 0, dy: 72, dw: 0, dh: 0 }] },
    ];
    expect(matchKnown(local, base)).toEqual([true, true, false]);
  });

  it("matches a piece of 4px or less of a move dev makes in one go, and still leaves the rest of the move to match", () => {
    const move = (dh: number) => ({ dx: 0, dy: 0, dw: 0, dh });
    const base = [{ ...item("shift", ["page"]), deltas: [move(-304)] }];
    const pieces = [{ ...item("shift", ["page"]), deltas: [move(-4)] }, { ...item("shift", ["page"]), deltas: [move(-300)] }];
    expect(matchKnown(pieces, base)).toEqual([true, true]);
    expect(matchKnown([{ ...item("shift", ["page"]), deltas: [move(4)] }], base)).toEqual([false]);
    expect(matchKnown([{ ...item("shift", ["page"]), deltas: [move(-12)] }], base)).toEqual([false]);
    expect(matchKnown([{ ...item("shift", ["thumb"]), deltas: [move(-3)] }], [{ ...item("shift", ["thumb"]), deltas: [move(-2)] }])).toEqual([false]);
  });

  it("lets each small piece use up the move it matches, so repeated 4px jumps here need as many there", () => {
    const move = (dh: number) => ({ dx: 0, dy: 0, dw: 0, dh });
    const base = [{ ...item("shift", ["card"]), deltas: [move(4)] }];
    const jump = { ...item("shift", ["card"]), deltas: [move(4)] };
    expect(matchKnown([jump, jump, jump], base)).toEqual([true, false, false]);
    expect(matchKnown([{ ...item("shift", ["card", "card"]), deltas: [move(4), move(4)] }], base)).toEqual([false]);
  });

  it("lets one movement there vouch for one element of a problem here, not for two that add up to it", () => {
    const move = (dy: number) => ({ dx: 0, dy, dw: 0, dh: 0 });
    const base = [{ ...item("shift", ["card"]), deltas: [move(100)] }];
    expect(matchKnown([{ ...item("shift", ["card", "card"]), deltas: [move(80), move(20)] }], base)).toEqual([false]);
    expect(matchKnown([{ ...item("shift", ["card"]), deltas: [move(96)] }], base)).toEqual([true]);
  });

  it("matches repeated elements by their closest fit, whichever order they moved in here", () => {
    const base = [{ ...item("shift", ["row", "row"]), deltas: [{ dx: 0, dy: 10, dw: 0, dh: 10 }, { dx: 0, dy: 10, dw: 0, dh: 0 }] }];
    const local = [{ ...item("shift", ["row", "row"]), deltas: [{ dx: 0, dy: 10, dw: 0, dh: 0 }, { dx: 0, dy: 10, dw: 0, dh: 10 }] }];
    expect(matchKnown(local, base)).toEqual([true]);
    const split = [{ ...item("shift", ["row", "row"]), deltas: [{ dx: 0, dy: 10, dw: 0, dh: 0 }, { dx: 0, dy: 0, dw: 0, dh: 10 }] }];
    expect(matchKnown(split, [{ ...item("shift", ["row"]), deltas: [{ dx: 0, dy: 10, dw: 0, dh: 10 }] }])).toEqual([false]);
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

describe("parseStep", () => {
  it("types the text after => into a selector that holds spaces", () => {
    expect(parseStep('fill role=textbox[name="Search terms"] => climate evidence')).toMatchObject({ verb: "fill", target: 'role=textbox[name="Search terms"]', text: "climate evidence" });
    expect(parseStep("fill #search climate evidence")).toMatchObject({ target: "#search", text: "climate evidence" });
    expect(() => parseStep("tap #search")).toThrow("Unknown step");
  });
});
