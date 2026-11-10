import { describe, expect, it } from "vitest";
import { inFlow, isPage } from "./setup";

describe("pages in the middle of a flow", () => {
  it("are signing in, an app's request, an invitation and a hand-off, in an organisation's pages too", () => {
    for (const path of ["/sign-in", "/sign-up/verify-email-address", "/connect", "/join/lab", "/from-library/r1", "/o/lab/from-library/r1"]) expect(inFlow(path)).toBe(true);
  });

  it("aren't any other page", () => {
    for (const path of ["/", "/library", "/o/lab/library", "/papers/W1", "/connections"]) expect(inFlow(path)).toBe(false);
  });
});

describe("what the setup can stand in for", () => {
  it("is a page, never a file a route serves or a route that only redirects", () => {
    for (const path of ["/", "/library", "/papers/OS1/a-title", "/o/lab/library"]) expect(isPage(path)).toBe(true);
    for (const path of ["/papers/OS1/report.pdf", "/papers/OS1/cite.bib", "/papers/OS1/cite.ris", "/papers/OS1/cover.png", "/papers/doi/10.1/x", "/question-stage/hold", "/api/x"]) expect(isPage(path)).toBe(false);
  });
});
