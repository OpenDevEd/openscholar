import { describe, expect, it } from "vitest";
import {
  summarizeFailures,
  type FailureInput,
} from "@/lib/extraction/failures-summary";

describe("summarizeFailures", () => {
  it("R1: empty list → total:0, byCode:[]", () => {
    expect(summarizeFailures([])).toEqual({ total: 0, byCode: [] });
  });

  it("R2: single error → one byCode entry with count:1 and retryable flag", () => {
    const input: FailureInput[] = [{ code: "rate_limit" }];
    expect(summarizeFailures(input)).toEqual({
      total: 1,
      byCode: [{ code: "rate_limit", count: 1, retryable: true }],
    });
  });
});
