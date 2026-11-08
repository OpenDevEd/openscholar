import { describe, expect, it } from "vitest";
import { COVER_KINDS, coverOf } from "./cover";

describe("a paper's placeholder cover", () => {
  it("is always the same for one paper, and papers don't all wear the same", () => {
    expect(coverOf("OS234347060")).toEqual(coverOf("OS234347060"));
    const looks = new Set(Array.from({ length: 60 }, (_, index) => JSON.stringify(coverOf(`OS${200000000 + index}`))));
    const kinds = new Set(Array.from({ length: 60 }, (_, index) => coverOf(`OS${200000000 + index}`).kind));
    expect(kinds.size).toBe(COVER_KINDS.length);
    expect(looks.size).toBeGreaterThan(10);
  });
});
