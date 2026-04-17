import { describe, expect, test } from "vitest";
import { MAX_PDF_BYTES, MAX_PDF_MB } from "@/lib/files/limits";

describe("lib/files/limits", () => {
  test("MAX_PDF_BYTES is exactly 100 MiB", () => {
    expect(MAX_PDF_BYTES).toBe(100 * 1024 * 1024);
  });

  test("MAX_PDF_MB is 100", () => {
    expect(MAX_PDF_MB).toBe(100);
  });

  test("MAX_PDF_BYTES and MAX_PDF_MB agree", () => {
    expect(MAX_PDF_BYTES / (1024 * 1024)).toBe(MAX_PDF_MB);
  });
});
