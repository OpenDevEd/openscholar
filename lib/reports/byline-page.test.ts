import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import { expect, test } from "vitest";
import { extractPdfJsTextPages } from "@/convex/extraction/pdfjs_extract";
import { buildPageTextFromItems } from "@/lib/extraction/pdfjs-text";
import { withBylinePage } from "./byline-page";
import { carries } from "./report";

const LINE = "Published in Openscholar Reports (ISSN {pending}), https://doi.org/10.53832/openscholar-reports.r100269";
const details = (title: string) => ({ title, subtitle: "", date: "2026-11-11", licence: "CC BY 4.0" as const, authors: [{ name: "Ada Okafor" }, { name: "Ben Ruiz" }] });

/** A PDF's text as a report's reading builds it (convex/reports/reading.ts). */
async function read(pdf: Uint8Array) {
  const opened = await extractPdfJsTextPages(pdf.slice().buffer);
  return { pages: opened.totalPages, text: opened.pages.map((page) => buildPageTextFromItems(page.items).text).join("\n") };
}

test("the page added to a PDF carries the byline where the byline check looks for it, with the report's details", async () => {
  // A narrow page, so the line wraps: the check must still find it whole.
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]).drawText("A report with no byline", { x: 20, y: 300, size: 12 });
  const original = await doc.save();
  expect(carries((await read(original)).text, LINE)).toBe(false);

  const added = await read(await withBylinePage(original, { line: LINE, series: "Openscholar Reports", details: details("Shade trees and maize yields") }));
  expect(added.pages).toBe(2);
  expect(carries(added.text, LINE)).toBe(true);
  expect(added.text).toContain("A report with no byline");
  expect(added.text).toContain("Shade trees and maize yields");
  expect(added.text).toContain("Ada Okafor, Ben Ruiz");
});

test("a PDF of tiny pages still gets the whole byline", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  expect(carries((await read(await withBylinePage(await doc.save(), { line: LINE, series: "Openscholar Reports" }))).text, LINE)).toBe(true);
});

test("the page is written again with the details as they now are, in place of the one before", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const first = await withBylinePage(await doc.save(), { line: LINE, series: "Openscholar Reports", details: details("A title read wrongly") });
  const again = await read(await withBylinePage(first, { line: LINE, series: "Openscholar Reports", details: details("The title its author set") }, { replaceLast: true }));
  expect(again.pages).toBe(2);
  expect(again.text).toContain("The title its author set");
  expect(again.text).not.toContain("A title read wrongly");
  expect(carries(again.text, LINE)).toBe(true);
});

test("a title in a script the page can't write is left out, and the byline is still there", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const added = await read(await withBylinePage(await doc.save(), { line: LINE, series: "Openscholar Reports", details: details("遮荫树与玉米产量") }));
  expect(carries(added.text, LINE)).toBe(true);
});

test("a name too long for one line is broken across lines and kept whole", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([420, 300]);
  const series = "Openscholar".repeat(12);
  const added = await read(await withBylinePage(await doc.save(), { line: LINE, series }));
  expect(carries(added.text, series)).toBe(true);
  expect(carries(added.text, LINE)).toBe(true);
});

test("a page stored upright and turned to read landscape gets an added page that reads landscape too", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).setRotation(degrees(90));
  const added = (await PDFDocument.load(await withBylinePage(await doc.save(), { line: LINE, series: "Openscholar Reports" }))).getPage(1);
  expect(added.getSize()).toEqual({ width: 842, height: 595 });
  expect(added.getRotation().angle).toBe(0);
  // A page cropped to landscape reads landscape, whatever size its sheet is.
  const cropped = await PDFDocument.create();
  cropped.addPage([595, 842]).setCropBox(0, 0, 595, 300);
  const page = (await PDFDocument.load(await withBylinePage(await cropped.save(), { line: LINE, series: "Openscholar Reports" }))).getPage(1).getSize();
  expect(page.width).toBeGreaterThan(page.height);
});

test("a date is written as precisely as the report states it", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const text = async (date: string) => (await read(await withBylinePage(await doc.save(), { line: LINE, series: "Openscholar Reports", details: { ...details("A title"), date } }))).text;
  expect(await text("2026-10")).toContain("October 2026");
  expect(await text("2026-10")).not.toContain("1 October 2026");
  expect(await text("2026-10-11")).toContain("11 October 2026");
});
