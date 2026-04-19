import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { cloneChatPapersForDuplicate } from "./chatPapersDuplicate";

const newJobId = "jobs_new" as unknown as Id<"extractionJobs">;

describe("cloneChatPapersForDuplicate", () => {
  it("returns an empty array when given no source rows", () => {
    expect(cloneChatPapersForDuplicate(newJobId, [], new Map())).toEqual([]);
  });

  it("maps a single row to the new sourceId and preserves included=false", () => {
    const oldSrc = "src_old" as unknown as Id<"extractionJobSources">;
    const newSrc = "src_new" as unknown as Id<"extractionJobSources">;
    const map = new Map([[oldSrc, newSrc]]);
    expect(
      cloneChatPapersForDuplicate(
        newJobId,
        [{ sourceId: oldSrc, included: false }],
        map,
      ),
    ).toEqual([{ jobId: newJobId, sourceId: newSrc, included: false }]);
  });
});
