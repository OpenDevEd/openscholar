import { describe, expect, it } from "vitest";

import { classifyWorkerSkip } from "./workflow";

describe("convex/extraction/workflow classifyWorkerSkip", () => {
  it.each([
    ["already_billed", "completed"],
    ["cancelled", "halted"],
    ["job_terminal", "halted"],
    ["paused", "park"],
    ["credits_exhausted", "park"],
    ["stale_epoch", "park"],
  ] as const)("routes %s to %s", (reason, expected) => {
    expect(classifyWorkerSkip(reason)).toBe(expected);
  });
});
