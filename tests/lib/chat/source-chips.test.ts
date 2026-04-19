import { describe, it, expect } from "vitest";
import {
  computeChipCounts,
  type ChippableSource,
} from "@/lib/chat/source-chips";

const row = (sourceType: ChippableSource["sourceType"]): ChippableSource => ({
  sourceType,
});

describe("computeChipCounts", () => {
  it("R1: empty input returns zeros for every chip bucket including unknown", () => {
    expect(computeChipCounts([])).toEqual({
      all: 0,
      openalex: 0,
      upload: 0,
      zotero: 0,
      history: 0,
      unknown: 0,
    });
  });
});

// row() is exercised by later cycles; suppress unused-import lint until then.
void row;
