import { describe, expect, it } from "vitest";
import { summarizeFailures } from "@/lib/extraction/failures-summary";

describe("summarizeFailures", () => {
  it("R1: empty list → total:0, byCode:[]", () => {
    expect(summarizeFailures([])).toEqual({ total: 0, byCode: [] });
  });
});
