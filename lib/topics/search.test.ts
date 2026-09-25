import { expect, it } from "vitest";
import { searchTopicCatalog } from "./search";

it("matches part of a word and puts names that start with it first", () => {
  const results = searchTopicCatalog("subfield", "educ");
  expect(results[0]).toEqual({ id: "3304", name: "Education", within: "Social Sciences" });
});

it("needs every word, in any order, and stays within the chosen level", () => {
  const results = searchTopicCatalog("topic", "learning machine");
  expect(results.length).toBeGreaterThan(0);
  for (const result of results) {
    expect(result.id).toMatch(/^T\d+$/);
    expect(result.name.toLowerCase()).toContain("learning");
    expect(result.name.toLowerCase()).toContain("machine");
  }
});

it("lists a level alphabetically when nothing is typed", () => {
  const names = searchTopicCatalog("field", "").map((result) => result.name);
  expect(names).toHaveLength(26);
  expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
});
