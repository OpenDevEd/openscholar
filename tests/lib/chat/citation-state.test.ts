import { describe, expect, it } from "vitest";
import {
  classifyCitationState,
  type CitationResolvable,
} from "@/lib/chat/citation-state";

const mk = (included: boolean): CitationResolvable =>
  ({ included }) as CitationResolvable;

describe("classifyCitationState", () => {
  it("returns 'unresolved' when paper is null", () => {
    expect(classifyCitationState(null)).toBe("unresolved");
  });

  it("returns 'included' when paper.included is true", () => {
    expect(classifyCitationState(mk(true))).toBe("included");
  });

  it("returns 'excluded' when paper.included is false", () => {
    expect(classifyCitationState(mk(false))).toBe("excluded");
  });

  it("does not mutate the paper object it inspects", () => {
    const paper = mk(true);
    const snapshot = { ...paper };
    classifyCitationState(paper);
    expect(paper).toEqual(snapshot);
  });
});
