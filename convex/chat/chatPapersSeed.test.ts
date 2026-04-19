import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { buildSeedChatPaperRows } from "./chatPapersSeed";

const jobId = "jobs_1" as unknown as Id<"extractionJobs">;

describe("buildSeedChatPaperRows", () => {
  it("returns an empty array when given no sources", () => {
    expect(buildSeedChatPaperRows(jobId, [])).toEqual([]);
  });

  it("builds one row with included=true for a single source", () => {
    const s1 = "src_1" as unknown as Id<"extractionJobSources">;
    expect(buildSeedChatPaperRows(jobId, [s1])).toEqual([
      { jobId, sourceId: s1, included: true },
    ]);
  });
});
