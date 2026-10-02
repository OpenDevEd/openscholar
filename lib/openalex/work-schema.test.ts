import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { workSchema } from "./work-schema";

/** Two Works as OpenAlex sent them on 1 October 2026: one with an SDG, one without an abstract. */
const samples = JSON.parse(readFileSync(new URL("./work-schema.samples.json", import.meta.url), "utf8")) as Record<string, unknown>[];
const work = samples[0] as Record<string, unknown> & { primary_topic: Record<string, unknown> };

describe("workSchema", () => {
  it("takes Works as OpenAlex sends them", () => {
    expect(samples.map((sample) => workSchema.safeParse(sample).success)).toEqual([true, true]);
  });

  it("takes a Work a page left fields out of, and a field OpenAlex adds later", () => {
    expect(workSchema.safeParse({ id: "https://openscholar.ai/OS1" }).success).toBe(true);
    expect(workSchema.safeParse({ ...work, a_field_added_later: { anything: 1 } }).success).toBe(true);
  });

  it("takes the nulls the OpenScholar API sends where its index knows no value", () => {
    const unscored = { ...work.primary_topic, score: null };
    const fromApi = {
      ...work, publication_year: null, publication_date: null, type: null,
      open_access: { ...(work.open_access as object), oa_status: null }, primary_topic: unscored, topics: [unscored],
    };
    expect(workSchema.safeParse(fromApi).success).toBe(true);
  });

  it("refuses a field of a shape the app cannot read", () => {
    const broken = [
      { ...work, primary_topic: { ...work.primary_topic, field: { display_name: "Ecology" } } },
      { ...work, biblio: { volume: 3 } },
      { ...work, sustainable_development_goals: [{ id: "https://metadata.un.org/sdg/13", display_name: "Climate action", score: "0.5" }] },
      { ...work, ids: { pmid: 123 } },
      { ...work, type: 5 },
      { ...work, authorships: [{ author: { display_name: null } }] },
      { ...work, counts_by_year: [{ year: "2020", cited_by_count: 1 }] },
      { ...work, primary_location: { source: { display_name: 7 } } },
    ];
    expect(broken.map((sample) => workSchema.safeParse(sample).success)).toEqual(broken.map(() => false));
  });
});
