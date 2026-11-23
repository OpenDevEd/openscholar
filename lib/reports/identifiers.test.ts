import { describe, expect, it } from "vitest";
import { DEFAULT_IDENTIFIERS, citedOf, clampChoose, pickProblem, settingsProblem, withAccounts, withNeeded, type Identifiers } from "./identifiers";
import { printedOf, providersOf } from "./report";

const settings = (patch: Partial<Record<"crossref" | "zenodo" | "docid", Identifiers["services"]["crossref"]["mode"]>>, rest: Partial<Identifiers> = {}): Identifiers => ({
  ...DEFAULT_IDENTIFIERS,
  ...rest,
  services: {
    crossref: { mode: patch.crossref ?? "required", price: 0 },
    zenodo: { mode: patch.zenodo ?? "required", price: 0 },
    docid: { mode: patch.docid ?? "off", price: 5 },
  },
});

describe("identifier services", () => {
  it("gives every report both identifiers when both are always used", () => {
    const both = settings({ docid: "required" });
    expect(settingsProblem(both)).toBeNull();
    expect(withNeeded(both, [])).toEqual(["crossref", "zenodo", "docid"]);
    expect(citedOf(both, [])).toBe("crossref");
  });

  it("lets an author pick exactly one of Crossref and DOCiD, printing the DOCiD only when it is minted at signing", () => {
    const either = settings({ crossref: "optional", docid: "optional" }, { choose: { min: 1, max: 1 }, docidAtSigning: true });
    expect(settingsProblem(either)).toBeNull();
    expect(pickProblem(either, ["docid"])).toBeNull();
    expect(citedOf(either, ["docid"])).toBe("docid");
    expect(pickProblem(either, ["crossref", "docid"])).toBe("tooMany");
    expect(pickProblem(either, [])).toBe("tooFew");
    // Without minting at signing, picking only DOCiD would leave the byline nothing to print.
    expect(settingsProblem({ ...either, docidAtSigning: false })).toBe("nothingPrinted");
  });

  it("keeps Zenodo with every Crossref DOI", () => {
    const optional = settings({ crossref: "optional", zenodo: "optional", docid: "required" }, { docidAtSigning: true });
    expect(withNeeded(optional, ["crossref"])).toEqual(["crossref", "zenodo", "docid"]);
  });

  it("refuses a pick rule no author could meet", () => {
    const optional = settings({ crossref: "required", docid: "optional" });
    expect(settingsProblem({ ...optional, choose: { min: 0.5, max: 0.5 } })).toBe("rule");
    expect(settingsProblem({ ...optional, choose: { min: 2, max: 2 } })).toBe("rule");
  });

  it("keeps the pick rule possible as a service moves from the author's pick to always", () => {
    const either = settings({ crossref: "optional", docid: "optional" }, { choose: { min: 1, max: 1 }, docidAtSigning: true });
    const moved = clampChoose({ ...either, services: { ...either.services, crossref: { mode: "required", price: 0 } } }, either);
    expect(moved.choose).toEqual({ min: 1, max: 1 });
    const any = settings({ crossref: "required", docid: "optional" });
    expect(clampChoose({ ...any, services: { ...any.services, docid: { mode: "required", price: 5 } } }, any).choose).toEqual({ min: 0, max: 0 });
  });

  it("switches off a service whose account is off, or DOCiD's until its types are set", () => {
    expect(withAccounts(settings({ docid: "required" }), { crossref: { mode: "custom" }, zenodo: { mode: "custom" }, docid: { mode: "custom", resourceTypeId: 18 } }).services.docid.mode).toBe("off");
    const off = withAccounts(settings({ docid: "required" }), { crossref: { mode: "custom" }, zenodo: { mode: "custom" } });
    expect(off.services.docid.mode).toBe("off");
  });

  it("registers DOCiD last, so its deposit carries the DOI already registered", () => {
    expect(providersOf({ crossref: true, zenodo: true, policy: "reuse-crossref", docid: true })).toEqual(["crossref", "zenodo", "docid"]);
    expect(providersOf({ crossref: false, zenodo: false, policy: "mint-zenodo", docid: true })).toEqual(["docid"]);
  });

  it("prints a report's DOCiD where it cites it, and nothing until DOCiD has minted it", () => {
    const route = { crossref: false, zenodo: false, policy: "mint-zenodo" as const, docid: true, cited: "docid" as const };
    expect(printedOf({ doi: "", registration: route })).toBeNull();
    expect(printedOf({ doi: "", registration: route, registrations: { docid: { state: "none", handle: "20.500.14351/abc123" } } })?.url).toBe("https://hdl.handle.net/20.500.14351/abc123");
    expect(printedOf({ doi: "10.53832/x", registration: { ...route, crossref: true, cited: "crossref" } })?.url).toBe("https://doi.org/10.53832/x");
  });
});
