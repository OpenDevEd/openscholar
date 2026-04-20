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
});
