import { describe, expect, it } from "vitest";
import { inFlow } from "./setup";

describe("pages in the middle of a flow", () => {
  it("are signing in, an app's request, an invitation and a hand-off, in an organisation's pages too", () => {
    for (const path of ["/sign-in", "/sign-up/verify-email-address", "/connect", "/join/lab", "/from-library/r1", "/o/lab/from-library/r1"]) expect(inFlow(path)).toBe(true);
  });

  it("aren't any other page", () => {
    for (const path of ["/", "/library", "/o/lab/library", "/papers/W1", "/connections"]) expect(inFlow(path)).toBe(false);
  });
});
