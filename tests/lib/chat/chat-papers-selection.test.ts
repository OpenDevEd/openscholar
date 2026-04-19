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

  it("flips a single row's included flag via patch", () => {
    const r1 = row(1, true);
    const out = applyInclusionPatch([r1], new Map([[cp(1), false]]));
    expect(out).toHaveLength(1);
    expect(out[0].chatPaperId).toBe(cp(1));
    expect(out[0].included).toBe(false);
  });

  it("leaves untargeted rows reference-equal while flipping the targeted one", () => {
    const r1 = row(1, true);
    const r2 = row(2, true);
    const out = applyInclusionPatch([r1, r2], new Map([[cp(1), false]]));
    expect(out).toHaveLength(2);
    expect(out[0]).not.toBe(r1);
    expect(out[0].included).toBe(false);
    expect(out[1]).toBe(r2);
  });

  it("does not mutate the input array or its rows (freeze-safe)", () => {
    const r1 = Object.freeze(row(1, true));
    const r2 = Object.freeze(row(2, true));
    const input = Object.freeze([r1, r2]);
    expect(() =>
      applyInclusionPatch(input, new Map([[cp(1), false]])),
    ).not.toThrow();
    expect(r1.included).toBe(true);
    expect(r2.included).toBe(true);
  });
});

describe("buildBulkPatch", () => {
  it("with undefined sourceIds targets every row that needs a change", () => {
    const rows = [row(1, true), row(2, false), row(3, true)];
    const patch = buildBulkPatch(rows, undefined, false);
    expect(patch.size).toBe(2);
    expect(patch.get(cp(1))).toBe(false);
    expect(patch.get(cp(3))).toBe(false);
    expect(patch.has(cp(2))).toBe(false);
  });

  it("skips rows already at the target state (empty patch)", () => {
    const rows = [row(1, true), row(2, true), row(3, true)];
    const patch = buildBulkPatch(rows, undefined, true);
    expect(patch.size).toBe(0);
  });

  it("with an explicit sourceIds list, filters to that subset", () => {
    const rows = [row(1, true), row(2, true), row(3, true)];
    const patch = buildBulkPatch(rows, [src(1), src(3)], false);
    expect(patch.size).toBe(2);
    expect(patch.get(cp(1))).toBe(false);
    expect(patch.get(cp(3))).toBe(false);
    expect(patch.has(cp(2))).toBe(false);
  });

  it("with an empty sourceIds array produces an empty patch (distinct from undefined)", () => {
    const rows = [row(1, true), row(2, true)];
    const patch = buildBulkPatch(rows, [], false);
    expect(patch.size).toBe(0);
  });
});
