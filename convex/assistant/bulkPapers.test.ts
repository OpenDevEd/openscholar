// A big bulk change's changes are kept in parts no heavier than a document can hold (#637).
import { expect, it } from "vitest";
import { partsOf } from "./bulkPapers";

it("splits changes by their encoded size, keeping each one whole and in order", () => {
  // Papers with long non-Latin abstracts: three bytes a character.
  const items = Array.from({ length: 300 }, (_, i) => ({ openalexId: `W${i}`, abstract: "تجربة".repeat(1_200) }));
  const parts = partsOf(items);
  for (const part of parts) expect(new TextEncoder().encode(part.items).length).toBeLessThanOrEqual(512 * 1024 + 2);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.flatMap((part) => JSON.parse(part.items) as typeof items)).toEqual(items);
  expect(parts.map((part) => part.first)).toEqual(parts.map((_, i) => parts.slice(0, i).reduce((sum, earlier) => sum + JSON.parse(earlier.items).length, 0)));
});
