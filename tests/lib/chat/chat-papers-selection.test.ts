import { describe, it, expect } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import {
  applyInclusionPatch,
  buildBulkPatch,
  type InclusionLike,
} from "@/lib/chat/chat-papers-selection";

type CP = Id<"chatPapers">;
type SRC = Id<"extractionJobSources">;

const cp = (n: number) => `cp${n}` as unknown as CP;
const src = (n: number) => `src${n}` as unknown as SRC;

const row = (
  n: number,
  included: boolean,
  sourceIndex = n,
): InclusionLike => ({
  chatPaperId: cp(n),
  sourceId: src(sourceIndex),
  included,
});

describe("applyInclusionPatch", () => {
  it("returns [] for empty input and empty patch", () => {
    expect(applyInclusionPatch([], new Map())).toEqual([]);
  });

  it("preserves identity of untouched rows when patch is empty", () => {
    const r1 = row(1, true);
    const r2 = row(2, false);
    const out = applyInclusionPatch([r1, r2], new Map());
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(r1);
    expect(out[1]).toBe(r2);
  });
});
