import { describe, expect, it } from "vitest";
import { bareWorkLink } from "./bare-work-link";

const link = (address: string) => bareWorkLink(new URL(address, "https://x.test"))?.toString() ?? null;

describe("an old results link holding a paper's address", () => {
  it("becomes the same link with the ID, on a saved search or in a workspace, keeping everything else", () => {
    expect(link("/results/abc?rel=https%3A%2F%2Fopenalex.org%2FW12&sort=x")).toBe("https://x.test/results/abc?rel=W12&sort=x");
    expect(link("/o/team/results?cites=https%3A%2F%2Fopenscholar.ai%2FOS7")).toBe("https://x.test/o/team/results?cites=OS7");
  });

  it("leaves a link that already holds IDs, or a value it can't read, so it never redirects to itself", () => {
    expect(link("/results/abc?citedBy=W12")).toBeNull();
    expect(link("/results/abc?rel=not-a-paper")).toBeNull();
  });

  it("leaves other pages", () => {
    expect(link("/library?rel=https%3A%2F%2Fopenalex.org%2FW12")).toBeNull();
  });
});
