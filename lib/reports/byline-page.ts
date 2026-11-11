import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

/**
 * The PDF with one more page at its end that carries `line` as text, for an author who has Openscholar add the
 * byline. The page takes the last page's size, and nothing else in the PDF changes.
 * Throws for a PDF pdf-lib can't open, and for a line Helvetica can't write (anything outside Latin script): the
 * caller then tells the author to add the line themselves.
 */
// ponytail: pdf-lib holds the whole PDF in memory to add one page, so a PDF near the 100 MB limit may not fit the
// action that calls this. Write the page as an incremental update to the file if that happens.
export async function withBylinePage(pdf: Uint8Array, line: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const { width, height } = doc.getPage(doc.getPageCount() - 1).getSize();
  const margin = Math.min(72, width / 8);
  const size = 11;
  doc.addPage([width, height]).drawText(line, {
    x: margin,
    y: height / 2,
    size,
    lineHeight: size * 1.5,
    maxWidth: width - 2 * margin,
    font: await doc.embedFont(StandardFonts.Helvetica),
    color: rgb(0.1, 0.1, 0.1),
  });
  return await doc.save();
}
