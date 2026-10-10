import { describe, expect, it } from "vitest";
import { analyzePhase, knownAfterLooks, matchKnown, stopDecision, type Frame, type Item } from "../scripts/verify/analysis.ts";
import { earlyStep, parseStep } from "../scripts/verify/browser.ts";

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

  it("accepts a frame that slides open over many frames, with what it pushes, but not the same distance in one", () => {
    const slide = Array.from({ length: 12 }, (_, step) => frame(500 + step * 16, { moved: [{ id: 1, dx: 0, dy: 0, dw: 0, dh: 10 }, { id: 2, dx: 0, dy: 10, dw: 0, dh: 0 }] }));
    expect(analyzePhase(slide, load)).toEqual([]);
    const jump = [frame(500, { moved: [{ id: 1, dx: 0, dy: 0, dw: 0, dh: 120 }, { id: 2, dx: 0, dy: 120, dw: 0, dh: 0 }] })];
    expect(analyzePhase(jump, load)).toHaveLength(1);
  });

  it("reports a jump hidden among the steps of a slide, on the same side or another", () => {
    const steps = (sizes: number[], extra: (index: number) => Partial<{ dx: number }> = () => ({})) =>
      sizes.map((dh, index) => frame(500 + index * 16, { moved: [{ id: 1, dx: 0, dy: 0, dw: 0, dh, ...extra(index) }] }));
    // 120 px in two frames, then a settle.
    expect(analyzePhase(steps([60, 60, 2, 2, 2]), load)).toHaveLength(1);
    // One 110 px step in the middle of twenty-four of 10 px.
    expect(analyzePhase(steps([...Array(12).fill(10), 110, ...Array(12).fill(10)]), load)).toHaveLength(1);
    // A smooth resize with one sideways jump.
    expect(analyzePhase(steps(Array(12).fill(10), (index) => (index === 5 ? { dx: 100 } : {})), load)).toHaveLength(1);
    // A slide that starts fast and eases out is still a slide.
    expect(analyzePhase(steps([15, 15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1]), load)).toEqual([]);
  });

  it("accepts real slides: an uneven start, and a slow end that moves a pixel every few frames", () => {
    // The rail's sections sliding down 68 px, as recorded at 120 frames a second.
    const rail = [2, 12, 7, 5, 8, 7, 6, 5, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1];
    const railAt = [0, 11, 19, 28, 36, 44, 53, 61, 69, 78, 86, 94, 103, 111, 119, 136, 153, 178, 219];
    expect(analyzePhase(rail.map((dy, index) => frame(500 + railAt[index], { moved: [{ id: 1, dx: 0, dy, dw: 0, dh: 0 }] })), load)).toEqual([]);
    // A dialog growing 10 px, a pixel at a time, with its last pixels far apart.
    const tailAt = [0, 9, 16, 25, 33, 41, 50, 58, 83, 138];
    expect(analyzePhase(tailAt.map((at) => frame(500 + at, { moved: [{ id: 1, dx: 0, dy: 0, dw: 0, dh: 1 }] })), load)).toEqual([]);
    // The same sections in a busy Firefox: what pushes them arrives over the first two frames, and a frame is dropped near the end.
    const busy = [2, 14, 12, 15, 6, 11, 2, 2, 3, 1];
    const busyAt = [0, 16, 31, 40, 73, 86, 108, 117, 172, 213];
    expect(analyzePhase(busy.map((dy, index) => frame(500 + busyAt[index], { moved: [{ id: 1, dx: 0, dy, dw: 0, dh: 0 }], added: index < 2 ? [{ id: 50 + index, box: [0, 0, 300, 20] }] : [] })), load)).toEqual([]);
    // Five rows popping in one after another are not a slide.
    expect(analyzePhase([0, 100, 200, 300, 400].map((at) => frame(500 + at, { moved: [{ id: 1, dx: 0, dy: 20, dw: 0, dh: 0 }] })), load)).not.toEqual([]);
  });

  it("drops the pixel or two a slide leaves on a part it carries, but not the same nudge by itself", () => {
    const slide = Array.from({ length: 12 }, (_, step) => frame(500 + step * 16, { moved: [{ id: 1, dx: 0, dy: 0, dw: 0, dh: 10 }, ...(step === 3 ? [{ id: 2, dx: 0, dy: 2, dw: 0, dh: 0 }] : [])] }));
    expect(analyzePhase(slide, load)).toEqual([]);
    expect(analyzePhase([frame(500, { moved: [{ id: 2, dx: 0, dy: 2, dw: 0, dh: 0 }] })], load)).toHaveLength(1);
  });

  it("drops a part nudged a pixel at a time while a slide passes it, but not one nudged further", () => {
    const beside = (nudge: number) =>
      Array.from({ length: 12 }, (_, step) => frame(500 + step * 16, { moved: [{ id: 1, dx: 0, dy: 0, dw: 0, dh: 10 }, ...([2, 6, 9].includes(step) ? [{ id: 2, dx: 0, dy: nudge, dw: 0, dh: 0 }] : [])] }));
    expect(analyzePhase(beside(1), load)).toEqual([]);
    expect(analyzePhase(beside(2), load)).toMatchObject([{ kind: "shift", moves: [{ id: 2, dy: 6 }] }]);
    // A pixel a frame for twenty frames down and twenty back is a wobble, not rounding.
    const wobble = Array.from({ length: 40 }, (_, step) => frame(500 + step * 16, { moved: [...(step < 12 ? [{ id: 1, dx: 0, dy: 0, dw: 0, dh: 10 }] : []), { id: 2, dx: 0, dy: step < 20 ? 1 : -1, dw: 0, dh: 0 }] }));
    expect(analyzePhase(wobble, load)).toMatchObject([{ kind: "shift", moves: [{ id: 2, dy: 20 }] }]);
  });

  it("reports what only looks like a slide: a long one with one big step, a wobble, and rows arriving one after another", () => {
    const moves = (sizes: number[], added: (index: number) => boolean = () => false) =>
      sizes.map((dy, index) => frame(500 + index * 16, { moved: [{ id: 1, dx: 0, dy, dw: 0, dh: 0 }], added: added(index) ? [{ id: 50 + index, box: [0, 0, 300, 20] as [number, number, number, number] }] : [] }));
    // Fifty-nine steps of 10 px and one of 60: a long slide doesn't buy a bigger jump.
    expect(analyzePhase(moves([...Array(30).fill(10), 60, ...Array(29).fill(10)]), load)).toHaveLength(1);
    // Back and forth, frame after frame.
    expect(analyzePhase(moves([10, -10, 10, -10, 10, -10]), load)).toHaveLength(1);
    // A footer pushed 20 px by a new row in each of six frames in a row.
    expect(analyzePhase(moves(Array(6).fill(20), () => true), load)).toHaveLength(1);
    // The same footer pulled up as a row leaves in each frame.
    expect(analyzePhase(Array.from({ length: 6 }, (_, index) => frame(500 + index * 16, { moved: [{ id: 1, dx: 0, dy: -20, dw: 0, dh: 0 }], removed: [{ id: 50 + index, box: [0, 0, 300, 20] }] })), load)).toHaveLength(1);
    // Out 60 px in one frame, then back past where it started.
    expect(analyzePhase(moves([60, -20, -20, -20, -20]), load)).toHaveLength(1);
    // Two thirds of the way in one frame, then settling.
    expect(analyzePhase(moves([60, 20, 7, 3, 1]), load)).toHaveLength(1);
  });

  it("accepts a slide whose other side was corrected by 2 px of rounding", () => {
    const slide = Array.from({ length: 12 }, (_, step) => frame(500 + step * 16, { moved: [{ id: 1, dx: 0, dy: 0, dw: step === 3 ? 2 : 0, dh: 10 }] }));
    expect(analyzePhase(slide, load)).toEqual([]);
  });

  it("keeps a jump out and back that happens beside a slide", () => {
    const slide = Array.from({ length: 12 }, (_, step) => frame(500 + step * 16, { moved: [{ id: 1, dx: 0, dy: 0, dw: 0, dh: 10 }, ...(step === 3 ? [{ id: 2, dx: 0, dy: 100, dw: 0, dh: 0 }] : step === 4 ? [{ id: 2, dx: 0, dy: -100, dw: 0, dh: 0 }] : [])] }));
    // The finding says how far it went, though it ended where it began.
    expect(analyzePhase(slide, load)).toMatchObject([{ kind: "shift", moves: [{ id: 2, dy: 100 }] }]);
  });

  it("still reports a jump that is followed by a few small settling steps", () => {
    const settle = Array.from({ length: 5 }, (_, step) => frame(516 + step * 16, { moved: [{ id: 1, dx: 0, dy: 0, dw: 0, dh: 2 }] }));
    const findings = analyzePhase([frame(500, { moved: [{ id: 1, dx: 0, dy: 0, dw: 0, dh: 110 }] }), ...settle], load);
    expect(findings).toEqual([{ kind: "shift", from: 500, to: 580, moves: [{ id: 1, dx: 0, dy: 0, dw: 0, dh: 120 }] }]);
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

  it("reports a stale number that is corrected once, moments after it appeared", () => {
    const findings = analyzePhase([frame(400, { textAdded: ["0 papers"] }), frame(500, { textRemoved: ["0 papers"], textAdded: ["126 papers"] })], load);
    expect(findings).toEqual([{ kind: "brief-text", text: "0 papers", from: 400, to: 500 }]);
  });

  it("still reports a counting number that leaves moments after it first appeared", () => {
    const findings = analyzePhase(
      [
        frame(400, { textAdded: ["Up to 4 credits"] }),
        frame(416, { textRemoved: ["Up to 4 credits"], textAdded: ["Up to 126 credits"] }),
        frame(600, { textRemoved: ["Up to 126 credits"] }),
      ],
      load,
    );
    expect(findings).toEqual([{ kind: "brief-text", text: "Up to 126 credits", from: 400, to: 600 }]);
  });

  it("pairs counting lines one to one, so a second copy that vanishes is still a blink", () => {
    const findings = analyzePhase(
      [
        frame(400, { textAdded: ["4 credits", "4 credits"] }),
        frame(416, { textRemoved: ["4 credits", "4 credits"], textAdded: ["126 credits"] }),
        frame(432, { textRemoved: ["126 credits"], textAdded: ["250 credits"] }),
      ],
      load,
    );
    expect(findings).toEqual([{ kind: "brief-text", text: "4 credits", from: 400, to: 416 }]);
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

  // A dialog (id 30) opens with a spinner; its list (id 31) arrives later.
  const opens = { opened: [30] };
  const list = { id: 31, box: [416, 160, 448, 240] as [number, number, number, number], within: 30 };

  it("reports content that pops into a dialog after it opened, as read on open", () => {
    const findings = analyzePhase([frame(1_040, opens), frame(1_700, { added: [list] })], step);
    expect(findings).toEqual([{ kind: "late-content", id: 31, from: 1_040, to: 1_700 }]);
  });

  it("accepts late content that fades or slides in, and what mounts as the dialog opens", () => {
    expect(analyzePhase([frame(1_040, opens), frame(1_700, { added: [{ ...list, entering: true }] })], step)).toEqual([]);
    expect(analyzePhase([frame(1_040, opens), frame(1_100, { added: [list] })], step)).toEqual([]);
  });

  it("judges late content only in the step that opened the dialog, never while a page loads", () => {
    expect(analyzePhase([frame(1_700, { added: [list] })], step)).toEqual([]);
    expect(analyzePhase([frame(140, opens), frame(900, { added: [list] })], { name: "load", kind: "load", start: 0, baseline: 100 })).toEqual([]);
  });

  it("ignores frames recorded before the action started", () => {
    const findings = analyzePhase([frame(900, { moved: [{ id: 1, dx: 0, dy: 50, dw: 0, dh: 0 }] })], step);
    expect(findings).toEqual([]);
  });
});

describe("analyzePhase on a step taken while the page loads", () => {
  const early = { name: "early click Workspace", kind: "early" as const, start: 0 };
  const opening = frame(400, { opened: [10], added: [{ id: 10, box: [8, 8, 300, 120] }] });
  // The page behind fills in: a list arrives and pushes the footer down.
  const behind = frame(900, { moved: [{ id: 1, dx: 0, dy: 300, dw: 0, dh: 0 }], added: [{ id: 2, box: [100, 0, 600, 300] }] });

  it("leaves the page behind the overlay to the load check", () => {
    expect(analyzePhase([opening, behind], early)).toEqual([]);
  });

  it("reports rows that land in the open overlay in one frame, and the jump they give it", () => {
    const rows = frame(1_400, { added: [{ id: 11, box: [16, 60, 284, 132], within: 10, entering: false }], moved: [{ id: 10, dx: 0, dy: 0, dw: 0, dh: 132, within: 10 }] });
    expect(analyzePhase([opening, behind, rows], early)).toMatchObject([
      { kind: "late-content", id: 11, from: 400, to: 1_400 },
      { kind: "shift", moves: [{ id: 10, dh: 132 }] },
    ]);
  });

  it("accepts rows that fade in while the overlay slides to their height", () => {
    const slide = Array.from({ length: 12 }, (_, at) =>
      frame(1_400 + at * 16, { moved: [{ id: 10, dx: 0, dy: 0, dw: 0, dh: 11, within: 10 }], added: at === 0 ? [{ id: 11, box: [16, 60, 284, 132], within: 10, entering: true }] : [] }),
    );
    expect(analyzePhase([opening, behind, ...slide], early)).toEqual([]);
  });

  it("takes what moves as the overlay opens as its opening", () => {
    const settling = frame(480, { moved: [{ id: 12, dx: 0, dy: 6, dw: 0, dh: 0, within: 10 }] });
    expect(analyzePhase([opening, settling], early)).toEqual([]);
  });

  it("accepts a slide that starts as the overlay opens and runs on after", () => {
    const growing = Array.from({ length: 12 }, (_, at) => frame(416 + at * 16, { moved: [{ id: 10, dx: 0, dy: 0, dw: 0, dh: 10, within: 10 }] }));
    expect(analyzePhase([opening, ...growing], early)).toEqual([]);
  });

  it("reports rows that leave the open overlay one after another", () => {
    const leaving = Array.from({ length: 6 }, (_, at) =>
      frame(1_400 + at * 16, { moved: [{ id: 12, dx: 0, dy: -20, dw: 0, dh: 0, within: 10 }], removed: [{ id: 20 + at, box: [16, 60, 284, 20], within: 10 }] }),
    );
    expect(analyzePhase([opening, ...leaving], early)).toMatchObject([{ kind: "shift", moves: [{ id: 12, dy: -120 }] }]);
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

  it("blocks when a changed file holds a dialog and the passing check opened none", () => {
    const changed = [{ path: "components/workspaces/share-dialog.tsx", mtimeMs: 5_000, overlay: true }];
    expect(stopDecision({ userFacing, stopHookActive: false, sessionStartMs, lastPassMs: 9_000, lastPassOpened: 0, changed })).toEqual({ block: true, files: ["components/workspaces/share-dialog.tsx"], unopened: true });
    expect(stopDecision({ userFacing, stopHookActive: false, sessionStartMs, lastPassMs: 9_000, lastPassOpened: 1, changed })).toEqual({ block: false });
    // A recorded skip opened nothing and says so by leaving the count out.
    expect(stopDecision({ userFacing, stopHookActive: false, sessionStartMs, lastPassMs: 9_000, changed })).toEqual({ block: false });
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
  it("takes only a step that acts on the page early", () => {
    expect(earlyStep([parseStep("click text=Workspace"), parseStep("press Escape")]).label).toBe("click text=Workspace");
    expect(() => earlyStep([])).toThrow("--early");
    expect(() => earlyStep([parseStep("wait 500")])).toThrow("--early");
    expect(() => earlyStep([parseStep("goto /library")])).toThrow("--early");
    // A key has no target to wait for.
    expect(() => earlyStep([parseStep("press Control+k")])).toThrow("--early");
  });

  it("types the text after => into a selector that holds spaces", () => {
    expect(parseStep('fill role=textbox[name="Search terms"] => climate evidence')).toMatchObject({ verb: "fill", target: 'role=textbox[name="Search terms"]', text: "climate evidence" });
    expect(parseStep("fill #search climate evidence")).toMatchObject({ target: "#search", text: "climate evidence" });
    expect(() => parseStep("tap #search")).toThrow("Unknown step");
  });
});
