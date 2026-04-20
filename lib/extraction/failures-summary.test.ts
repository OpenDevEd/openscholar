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

  it("R3: multiple same-code errors → one entry with count:N", () => {
    const input: FailureInput[] = [
      { code: "pdf_invalid" },
      { code: "pdf_invalid" },
      { code: "pdf_invalid" },
    ];
    expect(summarizeFailures(input)).toEqual({
      total: 3,
      byCode: [{ code: "pdf_invalid", count: 3, retryable: false }],
    });
  });
});
