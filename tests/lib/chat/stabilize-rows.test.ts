import { describe, expect, it } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import { stabilizeRowsById } from "@/lib/chat/stabilize-rows";

const cp = (n: number) => `cp${n}` as unknown as Id<"chatPapers">;
const src = (n: number) => `src${n}` as unknown as Id<"extractionJobSources">;
const job = "job1" as unknown as Id<"extractionJobs">;

function row(overrides: Partial<ChatSourceRow> = {}): ChatSourceRow {
  return {
    chatPaperId: cp(1),
    sourceId: src(1),
    jobId: job,
    position: 1,
    included: true,
    title: "Row one",
    authors: ["Smith, J"],
    year: 2024,
    abstract: null,
    doi: null,
    pdfUrl: null,
    openalexId: null,
    citedByCount: null,
    venueName: null,
    workType: null,
    bucketKey: "openalex:W1",
    sourceType: "openalex",
    ...overrides,
  };
}

describe("stabilizeRowsById", () => {
  it("returns an empty array when both prev and next are empty", () => {
    expect(stabilizeRowsById([], [])).toEqual([]);
  });

  it("returns a structural copy of next when prev is undefined", () => {
    const r1 = row();
    const r2 = row({ chatPaperId: cp(2), position: 2 });
    const next = [r1, r2];

    const out = stabilizeRowsById(undefined, next);

    expect(out).not.toBe(next);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(r1);
    expect(out[1]).toBe(r2);
  });

  it("preserves every element reference when prev and next are structurally identical", () => {
    const prev = [
      row(),
      row({ chatPaperId: cp(2), position: 2, title: "Row two" }),
      row({ chatPaperId: cp(3), position: 3, title: "Row three" }),
    ];
    const next = prev.map((r) => ({ ...r }));

    const out = stabilizeRowsById(prev, next);

    expect(out).toHaveLength(3);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(prev[1]);
    expect(out[2]).toBe(prev[2]);
  });

  it("gives the toggled row a new ref when only its `included` flag flips", () => {
    const prev = [
      row(),
      row({ chatPaperId: cp(2), position: 2, title: "Row two" }),
      row({ chatPaperId: cp(3), position: 3, title: "Row three" }),
    ];
    const next = [
      { ...prev[0]! },
      { ...prev[1]!, included: !prev[1]!.included },
      { ...prev[2]! },
    ];

    const out = stabilizeRowsById(prev, next);

    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(next[1]);
    expect(out[1]).not.toBe(prev[1]);
    expect(out[1]!.included).toBe(!prev[1]!.included);
    expect(out[2]).toBe(prev[2]);
  });

  it("gives a row a new ref when its `position` changes", () => {
    const prev = [
      row(),
      row({ chatPaperId: cp(2), position: 2, title: "Row two" }),
    ];
    const next = [{ ...prev[0]! }, { ...prev[1]!, position: 99 }];

    const out = stabilizeRowsById(prev, next);

    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(next[1]);
    expect(out[1]).not.toBe(prev[1]);
  });

  it("gives a row a new ref when its `title` changes", () => {
    const prev = [
      row(),
      row({ chatPaperId: cp(2), position: 2, title: "Row two" }),
    ];
    const next = [{ ...prev[0]! }, { ...prev[1]!, title: "Row two v2" }];

    const out = stabilizeRowsById(prev, next);

    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(next[1]);
    expect(out[1]).not.toBe(prev[1]);
  });

  it("drops a row that is absent from next and preserves refs for survivors", () => {
    const prev = [
      row(),
      row({ chatPaperId: cp(2), position: 2, title: "Row two" }),
      row({ chatPaperId: cp(3), position: 3, title: "Row three" }),
    ];
    const next = [{ ...prev[0]! }, { ...prev[2]! }];

    const out = stabilizeRowsById(prev, next);

    expect(out).toHaveLength(2);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(prev[2]);
    expect(out.some((r) => r.chatPaperId === cp(2))).toBe(false);
  });

  it("uses the incoming ref for a row added to next and preserves refs for existing rows", () => {
    const prev = [
      row(),
      row({ chatPaperId: cp(2), position: 2, title: "Row two" }),
    ];
    const newRow = row({ chatPaperId: cp(3), position: 3, title: "Row three" });
    const next = [{ ...prev[0]! }, { ...prev[1]! }, newRow];

    const out = stabilizeRowsById(prev, next);

    expect(out).toHaveLength(3);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(prev[1]);
    expect(out[2]).toBe(newRow);
  });

  it("preserves refs when array-index is reordered but each row's position field is unchanged", () => {
    const prev = [
      row({ chatPaperId: cp(1), position: 1 }),
      row({ chatPaperId: cp(2), position: 2 }),
    ];
    const next = [{ ...prev[1]! }, { ...prev[0]! }];

    const out = stabilizeRowsById(prev, next);

    expect(out).toHaveLength(2);
    expect(out[0]).toBe(prev[1]);
    expect(out[1]).toBe(prev[0]);
  });

  it("gives new refs when array-index is reordered and position fields are swapped", () => {
    const prev = [
      row({ chatPaperId: cp(1), position: 1 }),
      row({ chatPaperId: cp(2), position: 2 }),
    ];
    const next = [
      { ...prev[1]!, position: 1 },
      { ...prev[0]!, position: 2 },
    ];

    const out = stabilizeRowsById(prev, next);

    expect(out[0]).toBe(next[0]);
    expect(out[0]).not.toBe(prev[1]);
    expect(out[1]).toBe(next[1]);
    expect(out[1]).not.toBe(prev[0]);
  });

  it("preserves the row ref when authors is a new array with identical contents", () => {
    const prev = [row({ authors: ["Alpha", "Beta"] })];
    const next = [{ ...prev[0]!, authors: ["Alpha", "Beta"] }];

    const out = stabilizeRowsById(prev, next);

    expect(out[0]).toBe(prev[0]);
  });

  it("gives a new ref when authors has the same length but different contents", () => {
    const prev = [row({ authors: ["Alpha", "Beta"] })];
    const next = [{ ...prev[0]!, authors: ["Alpha", "Gamma"] }];

    const out = stabilizeRowsById(prev, next);

    expect(out[0]).toBe(next[0]);
    expect(out[0]).not.toBe(prev[0]);
  });

  it("gives a new ref when authors changes length", () => {
    const prev = [row({ authors: ["Alpha", "Beta"] })];
    const next = [{ ...prev[0]!, authors: ["Alpha"] }];

    const out = stabilizeRowsById(prev, next);

    expect(out[0]).toBe(next[0]);
    expect(out[0]).not.toBe(prev[0]);
  });

  it("does not mutate prev or next arrays", () => {
    const prev: ChatSourceRow[] = [
      row(),
      row({ chatPaperId: cp(2), position: 2, title: "Row two" }),
    ];
    const next: ChatSourceRow[] = [
      { ...prev[0]! },
      { ...prev[1]!, included: !prev[1]!.included },
    ];
    const prevSnapshot = prev.slice();
    const nextSnapshot = next.slice();

    stabilizeRowsById(prev, next);

    expect(prev).toEqual(prevSnapshot);
    expect(prev.length).toBe(prevSnapshot.length);
    prev.forEach((r, i) => expect(r).toBe(prevSnapshot[i]));
    expect(next).toEqual(nextSnapshot);
    next.forEach((r, i) => expect(r).toBe(nextSnapshot[i]));
  });

  it("preserves all 1000 prev refs when next is a structurally identical rebuild", () => {
    const N = 1000;
    const prev: ChatSourceRow[] = [];
    for (let i = 0; i < N; i += 1) {
      prev.push(
        row({
          chatPaperId: cp(i),
          sourceId: src(i),
          position: i,
          title: `Row ${i}`,
        }),
      );
    }
    const next = prev.map((r) => ({ ...r }));

    const out = stabilizeRowsById(prev, next);

    expect(out).toHaveLength(N);
    let preservedCount = 0;
    for (let i = 0; i < N; i += 1) {
      if (out[i] === prev[i]) preservedCount += 1;
    }
    expect(preservedCount).toBe(N);
  });

  it("preserves 999 prev refs when one row in a 1000-row list flips `included`", () => {
    const N = 1000;
    const changedIndex = 500;
    const prev: ChatSourceRow[] = [];
    for (let i = 0; i < N; i += 1) {
      prev.push(
        row({
          chatPaperId: cp(i),
          sourceId: src(i),
          position: i,
          title: `Row ${i}`,
        }),
      );
    }
    const next = prev.map((r, i) =>
      i === changedIndex ? { ...r, included: !r.included } : { ...r },
    );

    const out = stabilizeRowsById(prev, next);

    expect(out).toHaveLength(N);
    let preservedCount = 0;
    for (let i = 0; i < N; i += 1) {
      if (out[i] === prev[i]) preservedCount += 1;
    }
    expect(preservedCount).toBe(N - 1);
    expect(out[changedIndex]).toBe(next[changedIndex]);
    expect(out[changedIndex]).not.toBe(prev[changedIndex]);
  });
});
