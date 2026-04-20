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

  it("R4: multiple codes → sorted count-desc, ties broken by code-asc", () => {
    const input: FailureInput[] = [
      // Encounter order intentionally scrambled.
      { code: "schema_validation" }, // count 1, tie with moderation
      { code: "moderation" }, // count 1
      { code: "pdf_invalid" },
      { code: "pdf_invalid" },
      { code: "pdf_invalid" }, // count 3 → first
      { code: "rate_limit" },
      { code: "rate_limit" }, // count 2 → second
    ];
    const { byCode } = summarizeFailures(input);
    expect(byCode.map((e) => e.code)).toEqual([
      "pdf_invalid", // count 3
      "rate_limit", // count 2
      "moderation", // count 1, "moderation" < "schema_validation"
      "schema_validation", // count 1
    ]);
    expect(byCode.map((e) => e.count)).toEqual([3, 2, 1, 1]);
  });

  it("R5: total equals sum of per-code counts", () => {
    const input: FailureInput[] = [
      { code: "rate_limit" },
      { code: "rate_limit" },
      { code: "network" },
      { code: "pdf_invalid" },
      { code: "auth" },
      { code: "auth" },
      { code: "auth" },
    ];
    const result = summarizeFailures(input);
    const sum = result.byCode.reduce((acc, e) => acc + e.count, 0);
    expect(result.total).toBe(sum);
    expect(result.total).toBe(7);
  });

  it("R6: each entry carries retryable flag sourced from taxonomy.isRetryable", () => {
    const input: FailureInput[] = [
      { code: "rate_limit" }, // retryable:true per taxonomy
      { code: "pdf_invalid" }, // retryable:false
      { code: "network" }, // retryable:true
      { code: "auth" }, // retryable:false
      { code: "insufficient_credits" }, // retryable:true
    ];
    const byCodeMap = Object.fromEntries(
      summarizeFailures(input).byCode.map((e) => [e.code, e.retryable]),
    );
    expect(byCodeMap).toEqual({
      rate_limit: true,
      pdf_invalid: false,
      network: true,
      auth: false,
      insufficient_credits: true,
    });
  });
});
