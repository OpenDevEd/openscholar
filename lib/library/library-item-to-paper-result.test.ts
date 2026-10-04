import { describe, expect, it } from "vitest";
import type { Doc } from "@/convex/_generated/dataModel";
import { libraryItemToPaperResult } from "./library-item-to-paper-result";

const item = (paperData?: string) => ({ openalexId: "https://openalex.org/W7", title: "Tutoring at scale", authors: "Ada Okafor, Ben Mwangi", publicationYear: 2021, paperData }) as Doc<"libraryItems">;

describe("a saved paper as its card shows it", () => {
  it("is the record stored with it, or its saved fields when that isn't a paper's record", () => {
    const stored = { id: "https://openalex.org/W7", title: "Tutoring at scale", type: "article" };
    expect(libraryItemToPaperResult(item(JSON.stringify(stored)))).toEqual(stored);
    // A record with no ID of its own, text that isn't JSON, and no record at all: the card is built from what the library kept.
    for (const paperData of [JSON.stringify({ title: "Something else" }), "null", "not json", undefined]) {
      expect(libraryItemToPaperResult(item(paperData))).toMatchObject({ id: "https://openalex.org/W7", title: "Tutoring at scale", publication_year: 2021, authorships: [{ author: { display_name: "Ada Okafor" } }, { author: { display_name: "Ben Mwangi" } }] });
    }
  });
});
