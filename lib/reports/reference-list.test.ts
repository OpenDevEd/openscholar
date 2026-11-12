import { describe, expect, it } from "vitest";
import { referencesIn } from "./reference-list";

// What an author pastes or uploads into a report's References box becomes one reference a work.
describe("the references in a pasted text or a file", () => {
  it("reads a BibTeX file as one reference a record, with its DOI", () => {
    const found = referencesIn(`@article{piper2018,
  author = {Piper, Benjamin and Zuilkowski, Stephanie},
  title = {Scaling up successfully: Lessons from Kenya's Tusome national literacy program},
  journal = {Journal of Educational Change},
  year = {2018},
  doi = {10.1007/s10833-018-9325-4}
}
@book{duflo2011, author = {Banerjee, Abhijit and Duflo, Esther}, title = {Poor Economics}, year = {2011}, publisher = {PublicAffairs}}`);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ doi: "10.1007/s10833-018-9325-4" });
    expect(found[0]!.text).toContain("Scaling up successfully");
    expect(found[0]!.text).toContain("2018");
    expect(found[1]!.text).toContain("Poor Economics");
    expect(found[1]!.doi).toBeUndefined();
  });

  it("reads an RIS file as one reference a record", () => {
    const found = referencesIn("TY  - JOUR\nAU  - Piper, Benjamin\nTI  - Scaling up successfully\nPY  - 2018\nDO  - 10.1007/s10833-018-9325-4\nER  - \nTY  - BOOK\nAU  - Duflo, Esther\nTI  - Poor Economics\nPY  - 2011\nER  - \n");
    expect(found.map((reference) => reference.doi)).toEqual(["10.1007/s10833-018-9325-4", undefined]);
    expect(found[1]!.text).toContain("Poor Economics");
  });

  it("reads a plain list a line at a time, without its numbers, finding each DOI without the full stop after it", () => {
    expect(referencesIn("1. Piper, B. (2018). Scaling up successfully. https://doi.org/10.1007/s10833-018-9325-4.\n[2] Banerjee, A., & Duflo, E. (2011). Poor Economics.\n\n10.1596/978-1-4648-1096-1\n")).toEqual([
      { text: "Piper, B. (2018). Scaling up successfully. https://doi.org/10.1007/s10833-018-9325-4.", doi: "10.1007/s10833-018-9325-4" },
      { text: "Banerjee, A., & Duflo, E. (2011). Poor Economics." },
      { text: "", doi: "10.1596/978-1-4648-1096-1" },
    ]);
  });

  it("joins a reference a PDF wrapped over several lines, when blank lines part the references", () => {
    expect(referencesIn("Piper, B. (2018). Scaling up\nsuccessfully.\n\nBanerjee, A. (2011).\nPoor Economics.")).toEqual([{ text: "Piper, B. (2018). Scaling up successfully." }, { text: "Banerjee, A. (2011). Poor Economics." }]);
  });
});
