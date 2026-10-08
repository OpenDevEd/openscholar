import { describe, expect, it } from "vitest";
import { getCancelableScreeningWorkIds } from "./lifecycle";

describe("screening lifecycle helper", () => {

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
