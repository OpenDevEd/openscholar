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

  it("clones multiple rows and preserves included flags per-row", () => {
    const s1Old = "s1_old" as unknown as Id<"extractionJobSources">;
    const s2Old = "s2_old" as unknown as Id<"extractionJobSources">;
    const s1New = "s1_new" as unknown as Id<"extractionJobSources">;
    const s2New = "s2_new" as unknown as Id<"extractionJobSources">;
    const map = new Map([
      [s1Old, s1New],
      [s2Old, s2New],
    ]);
    expect(
      cloneChatPapersForDuplicate(
        newJobId,
        [
          { sourceId: s1Old, included: true },
          { sourceId: s2Old, included: false },
        ],
        map,
      ),
    ).toEqual([
      { jobId: newJobId, sourceId: s1New, included: true },
      { jobId: newJobId, sourceId: s2New, included: false },
    ]);
  });

  it("silently drops a row whose sourceId is not in the map", () => {
    const ghost = "ghost" as unknown as Id<"extractionJobSources">;
    expect(
      cloneChatPapersForDuplicate(
        newJobId,
        [{ sourceId: ghost, included: true }],
        new Map(),
      ),
    ).toEqual([]);
  });

  it("emits known rows and drops unknown ones when interleaved", () => {
    const s1Old = "s1_old" as unknown as Id<"extractionJobSources">;
    const ghost = "ghost" as unknown as Id<"extractionJobSources">;
    const s2Old = "s2_old" as unknown as Id<"extractionJobSources">;
    const s1New = "s1_new" as unknown as Id<"extractionJobSources">;
    const s2New = "s2_new" as unknown as Id<"extractionJobSources">;
    const map = new Map([
      [s1Old, s1New],
      [s2Old, s2New],
    ]);
    const rows = cloneChatPapersForDuplicate(
      newJobId,
      [
        { sourceId: s1Old, included: true },
        { sourceId: ghost, included: false },
        { sourceId: s2Old, included: true },
      ],
      map,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sourceId)).toEqual([s1New, s2New]);
  });

  it("stamps every emitted row with the same newJobId", () => {
    const other = "jobs_other_new" as unknown as Id<"extractionJobs">;
    const s1Old = "s1_old" as unknown as Id<"extractionJobSources">;
    const s2Old = "s2_old" as unknown as Id<"extractionJobSources">;
    const s1New = "s1_new" as unknown as Id<"extractionJobSources">;
    const s2New = "s2_new" as unknown as Id<"extractionJobSources">;
    const map = new Map([
      [s1Old, s1New],
      [s2Old, s2New],
    ]);
    const rows = cloneChatPapersForDuplicate(
      other,
      [
        { sourceId: s1Old, included: true },
        { sourceId: s2Old, included: false },
      ],
      map,
    );
    expect(rows.map((r) => r.jobId)).toEqual([other, other]);
  });
});
