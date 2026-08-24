import { describe, expect, it } from "vitest";
import {
  createEvidenceLibraryBaseSlug,
  createEvidenceLibraryPublicAddress,
  createEvidenceLibrarySlugCandidate,
  createInitialEvidenceLibraryShortName,
  normalizeEvidenceLibraryName,
  validateEvidenceLibraryPlatformDomain,
} from "./naming";

const TEST_PLATFORM_DOMAIN = "libraries.example.test";

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
    expect(() =>
      createEvidenceLibrarySlugCandidate("climate-evidence", 101),
    ).toThrow(/between 1 and 100/);
  });

  it("builds an address from a validated server domain", () => {
    expect(
      createEvidenceLibraryPublicAddress(
        "climate-evidence",
        TEST_PLATFORM_DOMAIN,
      ),
    ).toBe(
      "https://climate-evidence-lib.libraries.example.test",
    );
    expect(validateEvidenceLibraryPlatformDomain(" Example.TEST ")).toBe(
      "example.test",
    );
    expect(() => validateEvidenceLibraryPlatformDomain(undefined)).toThrow(
      /EVIDENCE_LIBRARY_PLATFORM_DOMAIN is required/,
    );
    expect(() =>
      validateEvidenceLibraryPlatformDomain("https://example.test"),
    ).toThrow(/DNS hostname/);
    expect(() =>
      validateEvidenceLibraryPlatformDomain("example.test:443"),
    ).toThrow(/DNS hostname/);
    expect(() => validateEvidenceLibraryPlatformDomain("localhost")).toThrow(
      /DNS hostname/,
    );
    expect(() => validateEvidenceLibraryPlatformDomain("127.0.0.1")).toThrow(
      /DNS hostname/,
    );
  });
});
