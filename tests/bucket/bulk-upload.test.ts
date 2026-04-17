import { describe, expect, test } from "vitest";
import {
  runWithConcurrency,
  validatePdfFile,
} from "@/lib/bucket/bulk-upload";
import { MAX_PDF_BYTES } from "@/lib/files/limits";

describe("validatePdfFile", () => {
  test("accepts application/pdf under the cap", () => {
    expect(
      validatePdfFile({ type: "application/pdf", size: 1_000 }, MAX_PDF_BYTES),
    ).toBeNull();
  });

  test("rejects wrong MIME", () => {
    expect(
      validatePdfFile({ type: "image/png", size: 1_000 }, MAX_PDF_BYTES),
    ).toBe("wrong-mime");
  });

  test("rejects oversized PDFs", () => {
    expect(
      validatePdfFile(
        { type: "application/pdf", size: MAX_PDF_BYTES + 1 },
        MAX_PDF_BYTES,
      ),
    ).toBe("too-large");
  });
});

describe("runWithConcurrency", () => {
  test("respects the concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await runWithConcurrency(
      items,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
      },
      3,
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(0);
  });

  test("captures per-item failures without aborting the batch", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(
      items,
      async (n) => {
        if (n === 3) throw new Error("boom");
        return n * 2;
      },
      2,
    );
    expect(results.every((r) => r !== undefined)).toBe(true);
    const third = results[2];
    expect(third.ok).toBe(false);
    if (!third.ok) expect(String(third.error)).toContain("boom");
    const first = results[0];
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value).toBe(2);
  });

  test("returns results in input order", async () => {
    const items = [10, 20, 30];
    const results = await runWithConcurrency(
      items,
      async (n) => {
        // Later items complete first
        await new Promise((r) => setTimeout(r, 50 - n));
        return n + 1;
      },
      3,
    );
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual([
      11, 21, 31,
    ]);
  });
});
