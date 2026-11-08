import { describe, expect, it } from "vitest";
import { abstractSections } from "./abstract-sections";

describe("structured abstracts", () => {
  it("splits one that runs its headings together, as The Lancet prints them", () => {
    const sections = abstractSections("Summary Background Stalled progress in malaria. Methods In this trial, 450 children were enrolled. Findings Efficacy was 74% (95% CI 63–82). Interpretation R21/MM appears safe. Funding The European Partnership.");
    expect(sections?.map((section) => section.heading)).toEqual(["Background", "Methods", "Findings", "Interpretation", "Funding"]);
    expect(sections?.[1]!.text).toBe("In this trial, 450 children were enrolled.");
  });

  it("leaves prose alone, even when a sentence starts with a heading's word", () => {
    expect(abstractSections("Malnutrition reduces learning. Results show that school meals help. Methods vary between schools.")).toBeNull();
    expect(abstractSections("We study school meals. Background noise matters. Methods are simple. Results Follow.")).toBeNull();
  });
});
