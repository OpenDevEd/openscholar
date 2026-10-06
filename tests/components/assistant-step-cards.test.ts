import { describe, expect, it } from "vitest";
import { runsOf, shownSteps } from "@/lib/assistant/step-cards";

const step = (id: string, action: string, more: Record<string, unknown> = {}) => ({ id, role: "step", status: "done", action, canUndo: false, undone: false, ...more });
const cards = (steps: ReturnType<typeof step>[]) => runsOf(steps).map((run) => run.map((one) => one.id));

describe("the step map's cards", () => {
  it("folds every read that shows the same card into one, wherever it ran in the reply", () => {
    // Three ways of reading a screening, between reading papers: two cards, not four.
    expect(cards([
      step("a", "screening/queries:getScreeningJob"),
      step("b", "research/papers:get"),
      step("c", "screening/queries:listScreeningResults"),
      step("d", "research/papers:get"),
      step("e", "screening/papers:get"),
    ])).toEqual([["a", "c", "e"], ["b", "d"]]);
  });

  it("keeps a step with something to press or read on its own card, in its place", () => {
    expect(cards([
      step("a", "research/records:listedSearches"),
      step("b", "library/papers:save", { canUndo: true }),
      step("c", "research/records:countSearches"),
      step("d", "research/records:listedSearches", { status: "failed", error: "It failed." }),
    ])).toEqual([["a", "c"], ["b"], ["d"]]);
  });

  it("hides a failed read once the same read ran again and worked, and keeps every other failure", () => {
    const failed = { status: "failed", error: "`about` takes at most 100 countries" };
    expect(shownSteps([
      step("a", "research/papers:search", { reads: true, ...failed }),
      step("b", "research/papers:search", { reads: true }),
      step("c", "research/papers:get", { reads: true, ...failed }),
      step("d", "library/papers:save", failed),
      step("e", "library/papers:save", { canUndo: true }),
    ]).map((one) => one.id)).toEqual(["b", "c", "d", "e"]);
  });
});
