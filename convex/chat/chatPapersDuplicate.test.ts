import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { cloneChatPapersForDuplicate } from "./chatPapersDuplicate";

const newJobId = "jobs_new" as unknown as Id<"extractionJobs">;

describe("cloneChatPapersForDuplicate", () => {
  it("returns an empty array when given no source rows", () => {
    expect(cloneChatPapersForDuplicate(newJobId, [], new Map())).toEqual([]);
  });
});
