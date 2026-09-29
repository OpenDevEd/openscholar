import { expect, it } from "vitest";
import { searchCatalogTopics, searchTopicCatalog } from "./search";

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

it("lists only topics under the chosen area, by name", () => {
  const topics = searchCatalogTopics("", "subfields/1702");
  expect(topics.length).toBeGreaterThan(1);
  expect(topics.every((topic) => topic.id.startsWith("T") && topic.path[2] === "Artificial Intelligence")).toBe(true);
  expect(topics.map((topic) => topic.name)).toEqual(topics.map((topic) => topic.name).toSorted((a, b) => a.localeCompare(b)));
});

it("finds topics by a parent's name or their ID, as the platform's directory did", () => {
  expect(searchCatalogTopics("T12260")[0].id).toBe("T12260");
  const byParent = searchCatalogTopics("pattern recognition").filter((topic) => !topic.name.toLowerCase().includes("pattern"));
  expect(byParent.length).toBeGreaterThan(0);
  expect(byParent.every((topic) => topic.path.includes("Computer Vision and Pattern Recognition"))).toBe(true);
});
