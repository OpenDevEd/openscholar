import { describe, expect, it } from "vitest";
import { namedExactly } from "./identifiers";

const names = (record: { names: string[] }) => record.names;

describe("namedExactly", () => {
  it("never takes a registry's guess named differently from what the PDF printed", () => {
    // ROR's affiliation matcher picked these, sure of each, for the two names on 2026-11-15.
    expect(namedExactly([{ names: ["Lebanon Valley College", "LVC"] }], "Draa Valley Collective", names)).toBeUndefined();
    expect(namedExactly([{ names: ["The Data Lab"] }], "Enugu Schools Data Lab", names)).toBeUndefined();
    expect(namedExactly([{ names: ["University of Medicine 1, Yangon"] }], "University of Medicine 2, Yangon", names)).toBeUndefined();
  });

  it("takes the one organisation that carries the printed name, as its own or another of its names", () => {
    const oxford = { names: ["Oxford University", "Prifysgol Rhydychen", "University of Oxford"] };
    expect(namedExactly([oxford], "Oxford University", names)).toBe(oxford);
    const lshtm = { names: ["LSHTM", "London School of Hygiene & Tropical Medicine"] };
    expect(namedExactly([lshtm], "London School of Hygiene and Tropical Medicine", names)).toBe(lshtm);
    const dataLab = { names: ["The Data Lab"] };
    expect(namedExactly([{ names: ["Data Laboratory"] }, dataLab], "data lab", names)).toBe(dataLab);
  });

  it("takes none when several organisations carry the name", () => {
    expect(namedExactly([{ names: ["Ministry of Health"] }, { names: ["Ministry of Health"] }], "Ministry of Health", names)).toBeUndefined();
  });
});
