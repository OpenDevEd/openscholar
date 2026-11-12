import { describe, expect, it } from "vitest";
import { reportSays } from "./published";

// The Already published check compares a report by what it says of itself, never by its title alone: a deck with no
// abstract was taken for a paper on the same topic (2026-11-12).
describe("what a report is compared by", () => {
  const report = { title: "AI and the value of human intelligence", date: "2026-07-01", authors: [] };
  it("is its abstract when it has one", () => {
    expect(reportSays({ ...report, abstract: "We surveyed 400 teachers.", text: "Cover page" })).toBe("We surveyed 400 teachers.");
  });
  it("is the opening of its PDF's text when it has no abstract", () => {
    const said = reportSays({ ...report, abstract: "", text: "Learn fast,\nact more slowly\n\n" + "slide ".repeat(1000) });
    expect(said.startsWith("Learn fast, act more slowly slide")).toBe(true);
    expect(said.length).toBeLessThanOrEqual(2500);
  });
});
