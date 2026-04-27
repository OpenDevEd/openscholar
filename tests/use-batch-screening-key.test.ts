/**
 * plan-05 — pure helper extracted from useBatchScreening so the batch-key
 * encoding has a contract independent of React hook plumbing. The key
 * orders papers and questions deterministically and folds in the
 * per-question test index from the transient screening store so a "Test"
 * click on a question produces a fresh batch.
 */
import { describe, it, expect } from "vitest";
import { buildScreeningBatchKey } from "@/lib/screening-utils";

interface Paper {
  id: string;
  title?: string;
  abstract?: string;
}

describe("buildScreeningBatchKey", () => {
  it("returns null when no papers need processing", () => {
    const papers: Paper[] = [{ id: "p1" }, { id: "p2" }];
    const missing: Record<string, string[]> = {};
    expect(buildScreeningBatchKey(papers, missing, {})).toBeNull();
  });

  it("returns null when papers have empty missing-question lists", () => {
    const papers: Paper[] = [{ id: "p1" }, { id: "p2" }];
    const missing: Record<string, string[]> = { p1: [], p2: [] };
    expect(buildScreeningBatchKey(papers, missing, {})).toBeNull();
  });

  it("encodes paperId:q#0,q#0|paperId:q#0,q#0 for two papers with two questions each", () => {
    const papers: Paper[] = [{ id: "p2" }, { id: "p1" }];
    const missing: Record<string, string[]> = {
      p1: ["question2", "question1"],
      p2: ["question1", "question2"],
    };
    const key = buildScreeningBatchKey(papers, missing, {});
    expect(key).toBe(
      "p1:question1#0,question2#0|p2:question1#0,question2#0",
    );
  });

  it("folds in per-question testIndex so a Test click changes the key", () => {
    const papers: Paper[] = [{ id: "p1" }];
    const missing: Record<string, string[]> = { p1: ["q1", "q2"] };
    const before = buildScreeningBatchKey(papers, missing, {});
    const after = buildScreeningBatchKey(papers, missing, { q1: 3 });
    expect(before).toBe("p1:q1#0,q2#0");
    expect(after).toBe("p1:q1#3,q2#0");
    expect(before).not.toBe(after);
  });

  it("only includes papers whose missing-question list is non-empty", () => {
    const papers: Paper[] = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
    const missing: Record<string, string[]> = {
      p1: ["q1"],
      p2: [],
      p3: ["q1"],
    };
    const key = buildScreeningBatchKey(papers, missing, {});
    expect(key).toBe("p1:q1#0|p3:q1#0");
  });
});
