import { describe, expect, it } from "vitest";
import { planChanges } from "../scripts/board-upkeep.mjs";

const sprints = [
  { id: "s6", startDate: "2026-10-05", duration: 7 },
  { id: "s7", startDate: "2026-10-12", duration: 7 },
];

function board(overrides: Partial<Parameters<typeof planChanges>[0]> = {}) {
  return planChanges({ items: [], issues: [], inReview: [], milestones: [], iterations: sprints, today: "2026-10-09", ...overrides });
}

const item = (number: number, state: "OPEN" | "CLOSED", status: string | null, extra: Record<string, unknown> = {}) => ({
  itemId: `item-${number}`,
  repo: "openalex-count",
  number,
  state,
  archived: false,
  status,
  sprintId: null,
  lastActivity: "2026-10-08T00:00:00Z",
  ...extra,
});

describe("planChanges", () => {
  it("moves closed issues to Done", () => {
    const plan = board({ items: [item(1, "CLOSED", "In progress"), item(2, "CLOSED", "Done"), item(3, "CLOSED", null)] });
    expect(plan.status).toEqual([
      { itemId: "item-1", issue: "openalex-count#1", to: "Done" },
      { itemId: "item-3", issue: "openalex-count#3", to: "Done" },
    ]);
  });

  it("moves an issue that an open pull request closes to In review, but never a blocked one", () => {
    const plan = board({
      items: [item(4, "OPEN", "In progress"), item(5, "OPEN", "Blocker"), item(6, "OPEN", "Backlog")],
      inReview: ["openalex-count#4", "openalex-count#5"],
    });
    expect(plan.status).toEqual([{ itemId: "item-4", issue: "openalex-count#4", to: "In review" }]);
  });

  it("gives an issue in progress the current sprint when it has none, also as it moves to In review", () => {
    const plan = board({
      items: [item(7, "OPEN", "In progress"), item(8, "OPEN", "In progress", { sprintId: "s6" }), item(9, "OPEN", "Ready"), item(13, "OPEN", "In progress")],
      inReview: ["openalex-count#13"],
    });
    expect(plan.sprint).toEqual([
      { itemId: "item-7", issue: "openalex-count#7", iterationId: "s6" },
      { itemId: "item-13", issue: "openalex-count#13", iterationId: "s6" },
    ]);
  });

  it("gives an open issue on the board without a status Backlog", () => {
    const plan = board({ items: [item(14, "OPEN", null), item(15, "OPEN", "Ready")] });
    expect(plan.status).toEqual([{ itemId: "item-14", issue: "openalex-count#14", to: "Backlog" }]);
  });

  it("adds missing issues to the board, a closed one as Done", () => {
    const plan = board({
      items: [item(10, "OPEN", "Ready")],
      issues: [
        { repo: "openalex-count", number: 10, contentId: "I_10", state: "OPEN" },
        { repo: "new-el", number: 10, contentId: "I_el10", state: "OPEN" },
        { repo: "new-el", number: 11, contentId: "I_el11", state: "CLOSED" },
      ],
    });
    expect(plan.add).toEqual([
      { contentId: "I_el10", issue: "new-el#10", to: "Backlog" },
      { contentId: "I_el11", issue: "new-el#11", to: "Done" },
    ]);
  });

  it("moves a reopened issue out of Done, to In review when a pull request closes it", () => {
    const plan = board({ items: [item(16, "OPEN", "Done"), item(17, "OPEN", "Done")], inReview: ["openalex-count#17"] });
    expect(plan.status).toEqual([
      { itemId: "item-16", issue: "openalex-count#16", to: "Backlog" },
      { itemId: "item-17", issue: "openalex-count#17", to: "In review" },
    ]);
  });

  it("moves an issue back to In progress, with the current sprint, when no open pull request closes it any more", () => {
    const plan = board({ items: [item(18, "OPEN", "In review"), item(19, "OPEN", "In review")], inReview: ["openalex-count#19"] });
    expect(plan.status).toEqual([{ itemId: "item-18", issue: "openalex-count#18", to: "In progress" }]);
    expect(plan.sprint).toEqual([{ itemId: "item-18", issue: "openalex-count#18", iterationId: "s6" }]);
  });

  it("leaves archived items alone, and doesn't add their issues again", () => {
    const plan = board({
      items: [item(20, "CLOSED", "In progress", { archived: true }), item(21, "OPEN", null, { archived: true })],
      issues: [{ repo: "openalex-count", number: 21, contentId: "I_21", state: "OPEN" }],
    });
    expect(plan.status).toEqual([]);
    expect(plan.add).toEqual([]);
  });

  it("closes a milestone whose issues are all closed, but not an empty one, and reopens one with an open issue", () => {
    const plan = board({
      milestones: [
        { repo: "openalex-count", number: 6, title: "OS-06", state: "open", open: 0, closed: 35 },
        { repo: "openalex-count", number: 15, title: "OS-15", state: "open", open: 0, closed: 0 },
        { repo: "new-el", number: 16, title: "EL-16", state: "open", open: 8, closed: 22 },
        { repo: "new-el", number: 9, title: "EL-09", state: "closed", open: 1, closed: 12 },
        { repo: "new-el", number: 8, title: "EL-08", state: "closed", open: 0, closed: 10 },
      ],
    });
    expect(plan.milestones).toEqual([
      { repo: "openalex-count", number: 6, title: "OS-06", to: "closed" },
      { repo: "new-el", number: 9, title: "EL-09", to: "open" },
    ]);
  });

  it("reports issues in progress with no activity for a week, and running out of sprints", () => {
    const plan = board({
      items: [item(11, "OPEN", "In progress", { sprintId: "s6", lastActivity: "2026-09-30T00:00:00Z" }), item(12, "OPEN", "In progress", { sprintId: "s6" })],
      iterations: [{ id: "s6", startDate: "2026-10-05", duration: 7 }],
    });
    expect(plan.stale).toEqual(["openalex-count#11"]);
    expect(plan.needsSprints).toBe(true);
  });
});
