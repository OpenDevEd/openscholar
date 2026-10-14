import { v } from "convex/values";
import { expect, it } from "vitest";
import { defineUserAction } from "./userActions";

// The assistant's twin of an action takes `userId` for the sender: an action taking a `userId` of its own had it
// overwritten, and organizations/manage:setRole changed the sender's role instead of the member's.
it("refuses an action whose arguments use a name the assistant's twin takes for itself", () => {
  const entry = (args: Record<string, ReturnType<typeof v.string>>) =>
    defineUserAction({ path: "test/actions:act", description: "", args, returns: v.null(), spendsCredits: false, outsideEffect: false, undoable: false, run: async () => null });
  expect(() => entry({ userId: v.string() })).toThrow(/test\/actions:act takes userId/);
  expect(entry({ memberId: v.string() }).path).toBe("test/actions:act");
});
