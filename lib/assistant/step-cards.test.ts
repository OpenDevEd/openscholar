import { expect, it } from "vitest";
import { askedGroups, runsOf, whyAsked } from "./step-cards";

it("gives an approval the reason its step asks for", () => {
  // Others see it and it can be undone: adding a paper to a collection shared with you, renaming an organization.
  expect(whyAsked({ outside: true, undoable: true })).toBe("whyShown");
  // Others see it and nothing puts it back: an invitation, a deleted chat.
  expect(whyAsked({ outside: true })).toBe("whyOutside");
  // Nothing puts it back: clearing every search.
  expect(whyAsked({})).toBe("whyUndo");
  // Many records at once, whatever each change is.
  expect(whyAsked({ batch: 40, outside: true, undoable: true })).toBe("whyMany");
});

const step = (id: string, action: string, more: Partial<{ status: string; variant: string; batch: number; credits: number; canUndo: boolean }> = {}) => ({ id, action, status: "done", ...more });
const ids = (groups: { id: string }[][]) => groups.map((group) => group.map((one) => one.id));

it("folds a reply's PDF reads, saves and failures of one kind into one card each", () => {
  const steps = [
    step("pdf1", "research/papers:readPdf", { credits: 4 }),
    step("save1", "library/papers:save", { canUndo: true }),
    step("pdf2", "research/papers:readPdf", { credits: 6 }),
    step("save2", "library/papers:save", { canUndo: true }),
    step("lost", "library/papers:save", { status: "failed" }),
    step("bulk", "library/papers:save", { batch: 40 }),
    step("lost2", "library/papers:save", { status: "failed" }),
    step("asks", "library/papers:save", { status: "asking" }),
  ];
  // The ones that failed are a card beside the ones that worked; a bulk change and a question each stay their own.
  expect(ids(runsOf(steps))).toEqual([["pdf1", "pdf2"], ["save1", "save2"], ["lost", "lost2"], ["bulk"], ["asks"]]);
});

it("asks once for the calls of one action a reply asked about together", () => {
  const steps = [
    step("pdf1", "research/papers:readPdf", { status: "asking", credits: 4 }),
    step("delete", "library/collections:deleteCollection", { status: "asking" }),
    step("pdf2", "research/papers:readPdf", { status: "asking", credits: 6 }),
    step("bulk", "library/papers:save", { status: "asking", batch: 40 }),
    step("bulk2", "library/papers:save", { status: "asking", batch: 12 }),
    step("in", "library/papers:collect", { status: "asking", variant: "in" }),
    step("out", "library/papers:collect", { status: "asking", variant: "out" }),
  ];
  // Two bulk changes are two questions, and putting a paper in a collection isn't taking one out.
  expect(ids(askedGroups(steps))).toEqual([["pdf1", "pdf2"], ["delete"], ["bulk"], ["bulk2"], ["in"], ["out"]]);
});
