import { describe, expect, it } from "vitest";
import {
  validatePauseTransition,
  validateResumeTransition,
} from "@/lib/extraction/transitions";

describe("validatePauseTransition", () => {
  it("R1: from 'extracting' → ok, nextStatus='paused', pausedFrom='extracting'", () => {
    expect(validatePauseTransition("extracting")).toEqual({
      ok: true,
      nextStatus: "paused",
      pausedFrom: "extracting",
    });
  });

  it("R2: from 'downloading_pdfs' → ok, pausedFrom carries through", () => {
    expect(validatePauseTransition("downloading_pdfs")).toEqual({
      ok: true,
      nextStatus: "paused",
      pausedFrom: "downloading_pdfs",
    });
  });

  it("R3: from 'indexing' → ok, pausedFrom carries through", () => {
    expect(validatePauseTransition("indexing")).toEqual({
      ok: true,
      nextStatus: "paused",
      pausedFrom: "indexing",
    });
  });

  it("R4: from 'paused' → not-ok with reason 'already_paused' (idempotent)", () => {
    expect(validatePauseTransition("paused")).toEqual({
      ok: false,
      reason: "already_paused",
    });
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "R5: from terminal status '%s' → not-ok with reason 'terminal'",
    (status) => {
      expect(validatePauseTransition(status)).toEqual({
        ok: false,
        reason: "terminal",
      });
    },
  );

  it("R6: from 'creditsExhausted' → not-ok with reason 'credits_exhausted'", () => {
    // Pause on an auto-paused (credits-exhausted) job is a distinct no-op —
    // the user should hit Buy Credits + Resume, not Pause.
    expect(validatePauseTransition("creditsExhausted")).toEqual({
      ok: false,
      reason: "credits_exhausted",
    });
  });
});

describe("validateResumeTransition", () => {
  it("R7: from 'paused' with pausedFromStatus='downloading_pdfs' → resumes back to that phase", () => {
    expect(
      validateResumeTransition({
        currentStatus: "paused",
        pausedFromStatus: "downloading_pdfs",
        availableCredits: 100,
        remainingEstimate: 50,
      }),
    ).toEqual({ ok: true, nextStatus: "downloading_pdfs" });
  });

  it("R8: from 'creditsExhausted' with sufficient balance → resumes to 'extracting'", () => {
    // creditsExhausted is only ever entered mid-extracting (plan 03), so
    // the resume target is always 'extracting' — no pausedFromStatus is
    // captured on that path.
    expect(
      validateResumeTransition({
        currentStatus: "creditsExhausted",
        availableCredits: 100,
        remainingEstimate: 50,
      }),
    ).toEqual({ ok: true, nextStatus: "extracting" });
  });

  it("R9: from 'creditsExhausted' with insufficient balance → not-ok with needed/available", () => {
    expect(
      validateResumeTransition({
        currentStatus: "creditsExhausted",
        availableCredits: 10,
        remainingEstimate: 50,
      }),
    ).toEqual({
      ok: false,
      reason: "insufficient_credits",
      needed: 50,
      available: 10,
    });
  });

  it("R10: from 'paused' with insufficient balance still resumes (user-pause doesn't gate on credits)", () => {
    // Paused-by-user is not a credit state. The user should be able to
    // resume even when they would immediately hit creditsExhausted mid-run
    // — that path is handled by plan 03's mid-run detection.
    expect(
      validateResumeTransition({
        currentStatus: "paused",
        pausedFromStatus: "extracting",
        availableCredits: 10,
        remainingEstimate: 50,
      }),
    ).toEqual({ ok: true, nextStatus: "extracting" });
  });

  it.each([
    "pending",
    "downloading_pdfs",
    "indexing",
    "extracting",
    "completed",
    "failed",
    "cancelled",
  ] as const)(
    "R11: from non-paused status '%s' → not-ok with reason 'not_paused'",
    (status) => {
      expect(
        validateResumeTransition({
          currentStatus: status,
          availableCredits: 100,
          remainingEstimate: 50,
        }),
      ).toEqual({ ok: false, reason: "not_paused" });
    },
  );
});
