import { expect, it } from "vitest";
import { sameWork } from "./server";

it("takes a DOI's metadata only when its title is the page's work", () => {
  expect(sameWork("The state of OA: a large-scale analysis of the prevalence and impact of Open Access articles", "The state of OA: a large-scale analysis of the prevalence and impact of Open Access articles")).toBe(true);
  expect(sameWork("Deep learning", "Deep learning: a review")).toBe(true);
  // One paper's record carried an encyclopedia entry's DOI.
  expect(sameWork("Self-Efficacy: The Exercise of Control", "Self-efficacy")).toBe(false);
  expect(sameWork("Anything", undefined)).toBe(true);
  // Accents written or not are the same words.
  expect(sameWork("Éducation au Sénégal", "Education au Senegal")).toBe(true);
});
