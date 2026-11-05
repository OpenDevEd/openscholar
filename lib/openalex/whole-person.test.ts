import { describe, expect, it } from "vitest";
import { pairedRecords, wholePerson } from "./whole-person";

const record = (openalex: string, works: number, citations: number, h: number) => ({
  id: `OSA${works}`,
  ids: { openalex: `https://openalex.org/${openalex}` },
  works_count: works,
  cited_by_count: citations,
  summary_stats: { h_index: h },
  topics: [{ id: "T1", display_name: "Kelp", count: works }],
});

describe("one person from our index's records", () => {
  it("leaves out records the filter finds for someone else", () => {
    const mine = [record("A1", 10, 100, 4), record("A1", 3, 7, 2)];
    expect(pairedRecords("A1", [...mine, record("A2", 50, 500, 9)])).toEqual(mine);
  });

  it("adds up counts and topics, and the largest record speaks for them", () => {
    const person = wholePerson([record("A1", 3, 7, 2), record("A1", 10, 100, 4)]);
    expect(person).toMatchObject({ id: "OSA10", works_count: 13, cited_by_count: 107, summary_stats: { h_index: 4 } });
    expect(person.topics).toEqual([{ id: "T1", display_name: "Kelp", count: 13 }]);
  });
});
