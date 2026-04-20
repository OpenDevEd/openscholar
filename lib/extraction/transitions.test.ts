import { describe, expect, it } from "vitest";
import { validatePauseTransition } from "@/lib/extraction/transitions";

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
