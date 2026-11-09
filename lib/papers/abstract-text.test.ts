import { expect, it } from "vitest";
import { abstractFromIndex, plainAbstract } from "./abstract-text";

it("leaves a publisher's markup out of an abstract and keeps its comparisons", () => {
  expect(plainAbstract('We propose <inline-formula> <tex-math notation="LaTeX">$IntelliDaM$ </tex-math></inline-formula>, a framework.')).toBe("We propose $IntelliDaM$ , a framework.");
  expect(plainAbstract("<jats:p>Scores rose (p < 0.05) when x > 3.</jats:p>")).toBe("Scores rose (p < 0.05) when x > 3.");
  expect(abstractFromIndex({ "<jats:p>Tutoring": [0], "helps.</jats:p>": [1] })).toBe("Tutoring helps.");
});
