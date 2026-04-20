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
});
