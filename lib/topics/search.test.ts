import { expect, it } from "vitest";
import { searchTopicCatalog } from "./search";

it("matches part of a word across every level, names that start with it first", () => {
  const results = searchTopicCatalog("educ");
  expect(results[0]).toEqual({ id: "subfields/3304", name: "Education", level: "subfield", path: ["Social Sciences"] });
  expect(results.some((result) => result.level === "topic")).toBe(true);
});

it("needs every word, in any order", () => {
  const results = searchTopicCatalog("learning machine");
  expect(results.length).toBeGreaterThan(0);
  for (const { name } of results) {
    expect(name.toLowerCase()).toContain("learning");
    expect(name.toLowerCase()).toContain("machine");
  }
});

it("starts with the broadest areas when nothing is typed", () => {
  const levels = searchTopicCatalog("").map((result) => result.level);
  expect(levels.slice(0, 4)).toEqual(["domain", "domain", "domain", "domain"]);
  expect(levels[4]).toBe("field");
});
