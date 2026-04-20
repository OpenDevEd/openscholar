import { describe, expect, it } from "vitest";
import {
  assertValidJobTransition,
  assertValidPaperTransition,
  JOB_STATUSES,
  PAPER_STATUSES,
} from "./stateMachine";

describe("assertValidJobTransition", () => {
  it("allows same-state no-op", () => {
    for (const s of JOB_STATUSES) {
      expect(() => assertValidJobTransition(s, s)).not.toThrow();
    }
  });

  it("allows pending → active phases", () => {
    for (const to of [
      "downloading_pdfs",
      "indexing",
      "extracting",
      "completed",
      "failed",
      "cancelled",
    ] as const) {
      expect(() => assertValidJobTransition("pending", to)).not.toThrow();
    }
  });

  it("allows extracting → terminal", () => {
    for (const to of ["completed", "failed", "cancelled"] as const) {
      expect(() => assertValidJobTransition("extracting", to)).not.toThrow();
    }
  });

  it.each([
    ["cancelled", "extracting"],
    ["completed", "failed"],
    ["failed", "completed"],
    ["cancelled", "completed"],
    ["indexing", "pending"],
    ["extracting", "downloading_pdfs"],
  ] as const)(
    "rejects illegal transition %s → %s",
    (from, to) => {
      expect(() => assertValidJobTransition(from, to)).toThrow(
        /invalid job status transition/,
      );
    },
  );

  it("creditsExhausted is non-terminal (resumable by plan 06)", () => {
    // Incoming edges: any active phase can run out of credits.
    for (const from of [
      "pending",
      "downloading_pdfs",
      "indexing",
      "extracting",
    ] as const) {
      expect(() =>
        assertValidJobTransition(from, "creditsExhausted"),
      ).not.toThrow();
    }
    // Outgoing edges: resume back to extracting, or move to terminal.
    for (const to of ["extracting", "completed", "cancelled", "failed"] as const) {
      expect(() =>
        assertValidJobTransition("creditsExhausted", to),
      ).not.toThrow();
    }
  });

  it("rejects creditsExhausted → illegal phases", () => {
    for (const to of ["pending", "downloading_pdfs", "indexing"] as const) {
      expect(() =>
        assertValidJobTransition("creditsExhausted", to),
      ).toThrow(/invalid job status transition/);
    }
  });
});

describe("assertValidPaperTransition", () => {
  it("allows same-state no-op", () => {
    for (const s of PAPER_STATUSES) {
      expect(() => assertValidPaperTransition(s, s)).not.toThrow();
    }
  });

  it("allows downloading → indexing → extracting → completed", () => {
    expect(() =>
      assertValidPaperTransition("downloading", "indexing"),
    ).not.toThrow();
    expect(() =>
      assertValidPaperTransition("indexing", "extracting"),
    ).not.toThrow();
    expect(() =>
      assertValidPaperTransition("extracting", "completed"),
    ).not.toThrow();
  });

  it.each([
    ["completed", "failed"],
    ["failed", "completed"],
    ["download_failed", "indexing"],
    ["indexing_failed", "extracting"],
    ["completed", "pending"],
    ["failed", "extracting"],
  ] as const)(
    "rejects illegal transition %s → %s",
    (from, to) => {
      expect(() => assertValidPaperTransition(from, to)).toThrow(
        /invalid paper status transition/,
      );
    },
  );
});
