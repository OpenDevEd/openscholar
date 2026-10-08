import { describe, expect, it } from "vitest";
import { inApp, linkBarePaths } from "./view";

describe("an address in a reply", () => {
  it("is a page of the app when it is a path on this site", () => {
    for (const address of ["/library", "/results/abc?page=2", "/library?col=x#top", "/"]) expect(inApp(address)).toBe(true);
  });

  it("isn't one when a browser would read it as another site's, whatever it starts with", () => {
    for (const address of ["//evil.example", "/\\evil.example", "/\\/evil.example", "/\t/evil.example", "/\n/evil.example", "https://evil.example/library", "javascript:alert(1)", "library", "#top", "", "mailto:a@b.c"]) {
      expect(inApp(address)).toBe(false);
    }
  });
});

describe("linkBarePaths", () => {
  const nameOf = (kind: string) => ({ search: "Saved search", collection: "Collection", extraction: "Extraction" })[kind] ?? kind;

  it("makes a record's bare address a link named by its kind, leaving the sentence's full stop outside", () => {
    expect(linkBarePaths("You can open it at /results/bc99f91e-a82e-48c9.", nameOf)).toBe("You can open it at [Saved search](/results/bc99f91e-a82e-48c9).");
    expect(linkBarePaths("Saved to /library?col=k57abc and /extraction/j12", nameOf)).toBe("Saved to [Collection](/library?col=k57abc) and [Extraction](/extraction/j12)");
  });

  it("leaves addresses already in a link, in code, and pages that aren't records as they are", () => {
    for (const text of ["[Tutoring](/results/abc)", "`/results/abc`", "```\n/results/abc\n```", "Start one at /extraction/new", "see https://x.org/results/abc"]) {
      expect(linkBarePaths(text, nameOf)).toBe(text);
    }
  });
});
