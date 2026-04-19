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

  it("emits one row per source with every included=true (length matches input)", () => {
    const sources = ["s1", "s2", "s3"].map(
      (s) => s as unknown as Id<"extractionJobSources">,
    );
    const rows = buildSeedChatPaperRows(jobId, sources);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.included === true)).toBe(true);
  });

  it("stamps every row with the same jobId as input", () => {
    const other = "jobs_other" as unknown as Id<"extractionJobs">;
    const sources = ["a", "b", "c"].map(
      (s) => s as unknown as Id<"extractionJobSources">,
    );
    const rows = buildSeedChatPaperRows(other, sources);
    expect(rows.map((r) => r.jobId)).toEqual([other, other, other]);
  });

  it("preserves source ordering in the output array", () => {
    const s1 = "z" as unknown as Id<"extractionJobSources">;
    const s2 = "a" as unknown as Id<"extractionJobSources">;
    const s3 = "m" as unknown as Id<"extractionJobSources">;
    const rows = buildSeedChatPaperRows(jobId, [s1, s2, s3]);
    expect(rows.map((r) => r.sourceId)).toEqual([s1, s2, s3]);
  });
});
