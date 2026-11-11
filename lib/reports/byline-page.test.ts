import { PDFDocument } from "@cantoo/pdf-lib";
import { expect, test } from "vitest";
import { extractPdfJsTextPages } from "@/convex/extraction/pdfjs_extract";
import { buildPageTextFromItems } from "@/lib/extraction/pdfjs-text";
import { withBylinePage } from "./byline-page";
import { carries } from "./report";

const LINE = "Published in Openscholar Reports (ISSN {pending}), https://doi.org/10.53832/openscholar-reports.r100269";

/** A PDF's text as a report's reading builds it (convex/reports/reading.ts). */
async function read(pdf: Uint8Array) {
  const opened = await extractPdfJsTextPages(pdf.slice().buffer);
  return { pages: opened.totalPages, text: opened.pages.map((page) => buildPageTextFromItems(page.items).text).join("\n") };
}

test("the page added to a PDF carries the byline where the byline check looks for it", async () => {
  // A narrow page, so the line wraps: the check must still find it whole.
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]).drawText("A report with no byline", { x: 20, y: 300, size: 12 });
  const original = await doc.save();
  expect(carries((await read(original)).text, LINE)).toBe(false);

  const added = await read(await withBylinePage(original, LINE));
  expect(added.pages).toBe(2);
  expect(carries(added.text, LINE)).toBe(true);
  expect(added.text).toContain("A report with no byline");
});

test("a PDF of tiny pages still gets the whole byline", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  expect(carries((await read(await withBylinePage(await doc.save(), LINE))).text, LINE)).toBe(true);
});
