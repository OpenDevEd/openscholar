import { describe, expect, it } from "vitest";
import {
  SCREENING_ACTIVE_JOB_STATUSES,
  SCREENING_TERMINAL_JOB_STATUSES,
  SCREENING_TERMINAL_RESULT_STATUSES,
  getCancelableScreeningWorkIds,
} from "./lifecycle";

describe("screening lifecycle helper", () => {
  it("treats only processing jobs as active after pending removal", () => {
    expect(SCREENING_ACTIVE_JOB_STATUSES).toEqual(["processing"]);
  });

  it("tracks the terminal screening job statuses", () => {
    expect(SCREENING_TERMINAL_JOB_STATUSES).toEqual([
      "completed",
      "cancelled",
      "failed",
      "creditsExhausted",
    ]);
  });

  it("tracks the terminal screening result statuses", () => {
    expect(SCREENING_TERMINAL_RESULT_STATUSES).toEqual([
      "completed",
      "failed",
      "skipped",
    ]);
  });

  it("derives cancelable work ids from non-terminal rows only", () => {
    expect(
      getCancelableScreeningWorkIds([
        { status: "processing", workId: "work_1" },
        { status: "completed", workId: "work_2" },
        { status: "failed", workId: "work_3" },
        { status: "processing" },
        { status: "skipped", workId: "work_4" },
      ])
    ).toEqual(["work_1"]);
  });
});
