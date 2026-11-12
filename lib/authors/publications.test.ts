import { describe, expect, it } from "vitest";
import { authorPublicationsFrom } from "./publications";

// An author's list shows a cover, a title page or "No PDF" for each publication, so each must say what its record holds.
describe("an author's publications", () => {
  const library = { id: "lib1", name: "Test community", url: "https://library.example" };
  const card = (cover: string | null) => ({ key: "ABCD1234", title: "A paper", itemType: "report", date: "2024", numPages: null, PDFCoverPageImage: cover, creators: [] });
  const read = async (cover: string | null, pdf?: () => Promise<{ url: string; cover: string | null } | null>) =>
    (await authorPublicationsFrom([{ id: "p1", itemKey: "ABCD1234", library }], async () => card(cover), "profile1", pdf)).papers[0]!;

  it("say whether a record with no picture has a PDF, where the list asks", async () => {
    expect(await read(null, async () => ({ url: "https://publisher.example/a.pdf", cover: null }))).toMatchObject({ pdf: { url: "https://publisher.example/a.pdf" } });
    expect(await read(null, async () => null)).toMatchObject({ pdf: null });
    // The picture its record holds is used when its card has none.
    expect(await read(null, async () => ({ url: "https://library.example/a.pdf", cover: "https://files.example/c.jpg" }))).toMatchObject({ cover: "https://files.example/c.jpg" });
  });
  it("leave it unknown, and stay listed, when the record can't answer or nothing asks", async () => {
    expect(await read(null, async () => { throw new Error("down"); })).not.toHaveProperty("pdf");
    expect(await read(null)).not.toHaveProperty("pdf");
  });
  it("never ask about a record whose card has its picture", async () => {
    let asked = 0;
    expect(await read("https://files.example/c.jpg", async () => (asked++, null))).toMatchObject({ cover: "https://files.example/c.jpg" });
    expect(asked).toBe(0);
  });
});
