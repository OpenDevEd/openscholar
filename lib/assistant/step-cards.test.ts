import { expect, it } from "vitest";
import { whyAsked } from "./step-cards";

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
