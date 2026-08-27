import { describe, expect, it } from "vitest";
import { evidenceLibraryAddressMoveCandidates } from "./addressRecovery";

const platformDomain = "libraries.example.test";

describe("Evidence Library address move candidates", () => {
  it("starts at the second position, never the plain name", () => {
    const candidates = evidenceLibraryAddressMoveCandidates({
      name: "Climate Evidence",
      platformDomain,
      currentAddress: "https://climate-evidence-lib.libraries.example.test",
    });
    expect(candidates.slice(0, 3)).toEqual([
      "https://climate-evidence-2-lib.libraries.example.test",
      "https://climate-evidence-3-lib.libraries.example.test",
      "https://climate-evidence-4-lib.libraries.example.test",
    ]);
  });

  it("skips the address the library sits on now", () => {
    const candidates = evidenceLibraryAddressMoveCandidates({
      name: "Climate Evidence",
      platformDomain,
      currentAddress: "https://climate-evidence-2-lib.libraries.example.test",
    });
    expect(candidates).not.toContain(
      "https://climate-evidence-2-lib.libraries.example.test",
    );
    expect(candidates[0]).toBe(
      "https://climate-evidence-3-lib.libraries.example.test",
    );
  });

  it("offers every numbered position once", () => {
    const candidates = evidenceLibraryAddressMoveCandidates({
      name: "Hello",
      platformDomain,
      currentAddress: "https://hello-lib.libraries.example.test",
    });
    expect(candidates).toHaveLength(99);
    expect(new Set(candidates).size).toBe(99);
    expect(candidates.at(-1)).toBe(
      "https://hello-100-lib.libraries.example.test",
    );
  });
});
