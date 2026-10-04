import { describe, expect, it } from "vitest";
import {
  summarizeRetryable,
  type RetryableResultInput,
} from "@/lib/extraction/retry-summary";
import { resultBuckets as bucketsOf } from "../../convex/extraction/counts";

/** Buckets each row the way the result counters do, then summarizes the counts. */
function summarize(results: ReadonlyArray<RetryableResultInput>) {
  const counts = { retryable: 0, permanent: {} as Record<string, number> };
  for (const result of results) {
    for (const bucket of bucketsOf({ jobId: "job" as never, status: result.status ?? "pending", lastError: result.lastError ?? undefined } as never)) {
      if (bucket === "retryable") counts.retryable += 1;
      if (bucket.startsWith("permanent:")) {
        const code = bucket.slice("permanent:".length);
        counts.permanent[code] = (counts.permanent[code] ?? 0) + 1;
      }
    }
  }
  return summarizeRetryable(counts);
}

describe("summarizeRetryable", () => {
  it("R1: empty list → zero counts and empty breakdown", () => {
    expect(summarize([])).toEqual({
      retryableCount: 0,
      permanentCount: 0,
      permanentBreakdown: {},
    });
  });

  it("R2: only completed results → all zeros (no failures to retry)", () => {
    const results: RetryableResultInput[] = [
      { status: "completed" },
      { status: "completed" },
      { status: "completed" },
    ];
    expect(summarize(results)).toEqual({
      retryableCount: 0,
      permanentCount: 0,
      permanentBreakdown: {},
    });
  });

  it("R3: one retryable failure (rate_limit) → retryableCount=1, empty breakdown", () => {
    const results: RetryableResultInput[] = [
      { status: "failed", lastError: { code: "rate_limit" } },
    ];
    expect(summarize(results)).toEqual({
      retryableCount: 1,
      permanentCount: 0,
      permanentBreakdown: {},
    });
  });

  it("R4: one permanent failure (pdf_invalid) → permanentCount=1 with per-code breakdown", () => {
    const results: RetryableResultInput[] = [
      { status: "failed", lastError: { code: "pdf_invalid" } },
    ];
    expect(summarize(results)).toEqual({
      retryableCount: 0,
      permanentCount: 1,
      permanentBreakdown: { pdf_invalid: 1 },
    });
  });

  it("R5: mixed bag — 2 rate_limit + 1 network retryable, 1 pdf_invalid + 1 moderation permanent", () => {
    const results: RetryableResultInput[] = [
      { status: "failed", lastError: { code: "rate_limit" } },
      { status: "failed", lastError: { code: "rate_limit" } },
      { status: "failed", lastError: { code: "network" } },
      { status: "failed", lastError: { code: "pdf_invalid" } },
      { status: "failed", lastError: { code: "moderation" } },
    ];
    expect(summarize(results)).toEqual({
      retryableCount: 3,
      permanentCount: 2,
      permanentBreakdown: { pdf_invalid: 1, moderation: 1 },
    });
  });

  it("R6: permanentBreakdown iterates count-desc, then code-asc on ties", () => {
    // Encounter order intentionally scrambled; sort must override it.
    const results: RetryableResultInput[] = [
      { status: "failed", lastError: { code: "schema_validation" } }, // 1, tie with moderation
      { status: "failed", lastError: { code: "moderation" } }, // 1
      { status: "failed", lastError: { code: "pdf_invalid" } },
      { status: "failed", lastError: { code: "pdf_invalid" } },
      { status: "failed", lastError: { code: "pdf_invalid" } }, // 3 → first
      { status: "failed", lastError: { code: "auth" } },
      { status: "failed", lastError: { code: "auth" } }, // 2 → second
    ];
    const { permanentBreakdown } = summarize(results);
    // Object.keys() iterates in insertion order; summarizer must insert
    // in the contract's sort order.
    expect(Object.keys(permanentBreakdown)).toEqual([
      "pdf_invalid", // count 3
      "auth", // count 2
      "moderation", // count 1, "moderation" < "schema_validation" lexicographically
      "schema_validation", // count 1
    ]);
    expect(permanentBreakdown).toEqual({
      pdf_invalid: 3,
      auth: 2,
      moderation: 1,
      schema_validation: 1,
    });
  });

  it("R7: unknown code (not in taxonomy) falls into retryable bucket — never trap the user", () => {
    const results: RetryableResultInput[] = [
      // Simulate a code produced by a future classifier revision that
      // this summarizer hasn't been taught about. If we naively asked
      // `isRetryable[code] !== false` we'd land here anyway; the
      // test pins the forward-compat guarantee.
      { status: "failed", lastError: { code: "future_unseen_code" } },
    ];
    expect(summarize(results)).toEqual({
      retryableCount: 1,
      permanentCount: 0,
      permanentBreakdown: {},
    });
  });

  it("R8: completed result carrying a stale lastError is ignored (status is the source of truth)", () => {
    // A result that succeeded after a previous attempt hit rate_limit.
    // The lastError from the failed attempt is still on the row but
    // the latest status is completed — it must not count.
    const results: RetryableResultInput[] = [
      { status: "completed", lastError: { code: "rate_limit" } },
      { status: "completed", lastError: { code: "pdf_invalid" } },
    ];
    expect(summarize(results)).toEqual({
      retryableCount: 0,
      permanentCount: 0,
      permanentBreakdown: {},
    });
  });

  it("R9: summarizer is pure — same input → same output, input unchanged", () => {
    const input: RetryableResultInput[] = [
      { status: "failed", lastError: { code: "rate_limit" } },
      { status: "failed", lastError: { code: "pdf_invalid" } },
      { status: "failed", lastError: { code: "moderation" } },
      { status: "completed" },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));

    const first = summarize(input);
    const second = summarize(input);

    // Deterministic output.
    expect(first).toEqual(second);
    // Input unchanged (no in-place sort, no field mutation).
    expect(input).toEqual(snapshot);
  });
});
