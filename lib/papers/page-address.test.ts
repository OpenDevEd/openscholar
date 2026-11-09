import { describe, expect, it } from "vitest";
import { paperPageId, paperPath, paperSlug } from "./page-address";

describe("paper page addresses", () => {
  it("takes our IDs and OpenAlex's, in any case, and nothing else", () => {
    expect(paperPageId("os257997330")).toBe("OS257997330");
    expect(paperPageId("W4362640605")).toBe("W4362640605");
    expect(paperPageId("OSA31035595")).toBeNull();
    expect(paperPageId("%")).toBeNull();
  });

  it("gives a title in any script an address a redirect can carry, which reads back as the slug the page compares", () => {
    for (const title of ["健康教育と栄養教育 (1) 健康教育の歴史と栄養教育", "Perception des enfants à l’égard d’un programme", "School Feeding: A 3-Arm Trial"]) {
      const path = paperPath("OS1", title);
      expect(path).toMatch(/^[\x21-\x7e]+$/);
      expect(decodeURIComponent(path.split("/")[3]!)).toBe(paperSlug(title));
    }
    expect(paperPath("OS1", "  ")).toBe("/papers/OS1");
  });
});
