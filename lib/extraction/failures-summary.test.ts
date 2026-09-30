import { describe, expect, it } from "vitest";
import { summarizeFailures } from "@/lib/extraction/failures-summary";

type FailureInput = { code: string };

/** The per-code counts the paper error counters hold for these rows. */
const summarize = (rows: ReadonlyArray<FailureInput>) => {
  const counts: Record<string, number> = {};
  for (const { code } of rows) counts[code] = (counts[code] ?? 0) + 1;
  return summarizeFailures(counts);
};

describe("summarizeFailures", () => {
  it("R1: empty list → total:0, byCode:[]", () => {
    expect(summarize([])).toEqual({ total: 0, byCode: [] });
  });

  it("R2: single error → one byCode entry with count:1 and retryable flag", () => {
    const input: FailureInput[] = [{ code: "rate_limit" }];
    expect(summarize(input)).toEqual({
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
    expect(summarize(input)).toEqual({
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
    const { byCode } = summarize(input);
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
    const result = summarize(input);
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
      summarize(input).byCode.map((e) => [e.code, e.retryable]),
    );
    expect(byCodeMap).toEqual({
      rate_limit: true,
      pdf_invalid: false,
      network: true,
      auth: false,
      insufficient_credits: true,
    });
  });

  it("R7: unknown code defaults retryable:true and preserves the code string", () => {
    // Simulate codes the classifier hasn't been taught about yet — the
    // summarizer must not trap the user behind retryable:false on an
    // unrecognised string.
    const input: FailureInput[] = [
      { code: "future_unseen_code" },
      { code: "also_unseen" },
    ];
    const result = summarize(input);
    expect(result.total).toBe(2);
    for (const entry of result.byCode) {
      expect(entry.retryable).toBe(true);
    }
    // Code strings survive verbatim — the UI uses them as a label
    // fallback when no taxonomy translation is registered.
    expect(result.byCode.map((e) => e.code).sort()).toEqual([
      "also_unseen",
      "future_unseen_code",
    ]);
  });

  it("R8: pure — deterministic output and no input mutation", () => {
    const input: FailureInput[] = [
      { code: "rate_limit" },
      { code: "pdf_invalid" },
      { code: "moderation" },
      { code: "rate_limit" },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));

    const first = summarize(input);
    const second = summarize(input);

    // Deterministic output.
    expect(first).toEqual(second);
    // Input array and its elements are not mutated.
    expect(input).toEqual(snapshot);
  });
});
