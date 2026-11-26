import { describe, expect, it } from "vitest";
import { fillAgreement } from "./agreement";
import type { ServiceId } from "./identifiers";

// The signed agreement is a legal contract: it has to name exactly the identifiers and archive the report gets.
const filled = (services: ServiceId[], ownArchive = false) => fillAgreement("2.1. Openscholar will publish the Work. [identifiers]", { name: "A Name", date: new Date("2026-11-26"), byline: "", licence: "CC BY 4.0", services, ownArchive });

describe("the services an agreement names", () => {
  it("names a Crossref DOI and Openscholar's Zenodo copy, and nothing it doesn't get", () => {
    const text = filled(["crossref", "zenodo"]);
    expect(text).toContain("Crossref");
    expect(text).toContain("on Zenodo");
    expect(text).not.toContain("DOCiD");
    expect(text).not.toContain("to be confirmed");
  });

  it("says the copy is in the author's own Zenodo account when they archive there", () => {
    expect(filled(["crossref", "zenodo"], true)).toContain("Author’s own Zenodo account");
  });

  it("names DOCiD only when the report gets one", () => {
    expect(filled(["crossref", "zenodo", "docid"])).toContain("DOCiD");
  });
});
