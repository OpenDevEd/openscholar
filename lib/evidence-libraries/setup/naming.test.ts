import { describe, expect, it } from "vitest";
import {
  createEvidenceLibraryBaseSlug,
  createEvidenceLibraryPublicAddress,
  createEvidenceLibrarySlugCandidate,
  createInitialEvidenceLibraryShortName,
  normalizeEvidenceLibraryName,
} from "./naming";

describe("Evidence Library setup naming", () => {
  it("normalizes the display name and creates the initial short name", () => {
    expect(normalizeEvidenceLibraryName("  Climate   Evidence Hub  ")).toBe(
      "Climate Evidence Hub",
    );
    expect(
      createInitialEvidenceLibraryShortName(
        "International Centre for Climate and Education Evidence",
      ),
    ).toBe("International Centre for Climate and");
  });

  it("creates a stable DNS-safe slug from the library name", () => {
    expect(createEvidenceLibraryBaseSlug("Éducation & Climate Evidence")).toBe(
      "education-and-climate-evidence",
    );
    expect(createEvidenceLibraryBaseSlug("教育")).toBe("library");
  });

  it("adds a bounded suffix for collisions", () => {
    expect(createEvidenceLibrarySlugCandidate("climate-evidence", 1)).toBe(
      "climate-evidence",
    );
    expect(createEvidenceLibrarySlugCandidate("climate-evidence", 2)).toBe(
      "climate-evidence-2",
    );

    const candidate = createEvidenceLibrarySlugCandidate("a".repeat(80), 100);
    expect(candidate.endsWith("-100")).toBe(true);
    expect(`${candidate}-lib`.length).toBeLessThanOrEqual(63);
  });

  it("builds the fixed platform address", () => {
    expect(createEvidenceLibraryPublicAddress("climate-evidence")).toBe(
      "https://climate-evidence-lib.openscholar.ai",
    );
  });
});
