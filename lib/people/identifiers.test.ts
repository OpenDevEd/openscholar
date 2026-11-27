import { afterEach, describe, expect, it, vi } from "vitest";
import { matchOrcid, namedExactly, sameInstitution } from "./identifiers";

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

describe("sameInstitution", () => {
  it("takes an ORCID record's institution that carries every word the PDF printed", () => {
    // Swati Mantri's ORCID record and the names R100719's PDF printed for her (2026-11-27).
    expect(sameInstitution("Campbell South Asia", "Campbell Collaboration South Asia")).toBe(true);
    expect(sameInstitution("The Research and Evaluation Centre", "Research & Evaluation Centre UK")).toBe(true);
  });

  it("refuses an institution missing one of the printed words", () => {
    expect(sameInstitution("University of Medicine 2, Yangon", "University of Medicine 1, Yangon")).toBe(false);
    expect(sameInstitution("Lanzhou University", "University of Utah")).toBe(false);
    expect(sameInstitution("The", "The Data Lab")).toBe(false);
  });
});

describe("matchOrcid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks ORCID for an institution's words with their accents", async () => {
    // ORCID's affiliation search finds 621 people at "+universite +montreal" and 11,244 at "+université +montréal" (2026-11-27).
    const fetched = vi.fn(async (_url: URL) => Response.json({ "expanded-result": [], "num-found": 0 }));
    vi.stubGlobal("fetch", fetched);
    await matchOrcid("Example Author", ["Université de Montréal"]);
    expect(fetched.mock.calls[0]![0].searchParams.get("q")).toContain("affiliation-org-name:(+université +de +montréal)");
    // A vowel sign is part of its word, not a break in it.
    await matchOrcid("Example Author", ["दिल्ली विश्वविद्यालय"]);
    expect(fetched.mock.calls[1]![0].searchParams.get("q")).toContain("affiliation-org-name:(+दिल्ली +विश्वविद्यालय)");
  });
});
