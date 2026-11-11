import { PDFDocument, StandardFonts, rgb, type PDFFont } from "@cantoo/pdf-lib";
import { LICENCE_URL, type Metadata } from "./report";

/** What the page Openscholar adds to a report's PDF says. Everything but the byline is left out when it isn't known yet. */
export type BylinePage = {
  /** The report's byline, word for word: the line the byline check looks for. It names the series' ISSN and the DOI. */
  line: string;
  /** The series the report is published in. */
  series: string;
  details?: Pick<Metadata, "title" | "subtitle" | "date" | "licence"> & { authors: Array<{ name: string }> };
};

const PUBLISHER = "Openscholar";
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.4, 0.4, 0.4);

/** `text` in lines no wider than `width`. A word wider than that, as a DOI's address on a narrow page, keeps its own line. */
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const tried = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
    if (lines.length && font.widthOfTextAtSize(tried, size) <= width) lines[lines.length - 1] = tried;
    else lines.push(word);
  }
  return lines;
}

/**
 * The PDF with one more page at its end, for an author who has Openscholar add the byline: the series, the report's
 * title, authors, date, licence and publisher, and the byline itself, as text. The page takes the last page's size,
 * or one large enough for what it says when that page is smaller, and nothing else in the PDF changes. With
 * `replaceLast`, the page takes the place of the one added before, as when the details have changed since.
 * Throws for a PDF pdf-lib can't open. The byline is always written; a title or a name Helvetica can't write
 * (anything outside Latin script) is left out.
 */
// ponytail: pdf-lib holds the whole PDF in memory to add one page, so a PDF near the 100 MB limit may not fit the
// action that calls this. Write the page as an incremental update to the file if that happens. Embed a Unicode font
// when reports in other scripts need their title on this page.
export async function withBylinePage(pdf: Uint8Array, { line, series, details }: BylinePage, { replaceLast = false } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  if (replaceLast && doc.getPageCount() > 1) doc.removePage(doc.getPageCount() - 1);
  const last = doc.getPage(doc.getPageCount() - 1).getSize();
  const plain = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // Wide enough for a DOI's address on one line.
  const width = Math.max(last.width, 420);
  const margin = Math.min(72, width / 8);
  const room = width - 2 * margin;
  const writable = (text: string) => {
    try {
      plain.encodeText(text);
      return true;
    } catch {
      return false;
    }
  };
  if (!writable(line)) throw new Error("The byline has characters this page can't write.");
  type Row = { text: string; font: PDFFont; size: number; color: typeof INK; gap: number };
  const row = (text: string | undefined, font: PDFFont, size: number, gap: number, color = INK): Row[] => (text?.trim() && writable(text) ? [{ text: text.trim(), font, size, color, gap }] : []);
  const names = details?.authors.map((author) => author.name.trim()).filter(Boolean).join(", ");
  const rows = [
    ...row(series, bold, 14, 0),
    ...row(details?.title, bold, 12, 22),
    ...row(details?.subtitle, plain, 11, 4),
    ...row(names, plain, 11, 10),
    ...row(details?.date, plain, 10, 4, MUTED),
    ...(details ? row(`${details.licence}, ${LICENCE_URL[details.licence]}`, plain, 10, 18, MUTED) : []),
    ...row(`Published by ${PUBLISHER}`, plain, 10, 4, MUTED),
    ...row(line, plain, 11, 22),
  ].map((r) => ({ ...r, lines: wrap(r.text, r.font, r.size, room) }));
  const tall = rows.reduce((sum, r) => sum + r.gap + r.lines.length * r.size * 1.45, 0);
  const height = Math.max(last.height, tall + 2 * margin);
  const page = doc.addPage([width, height]);
  let y = height - margin;
  for (const r of rows) {
    y -= r.gap;
    for (const text of r.lines) {
      y -= r.size * 1.45;
      page.drawText(text, { x: margin, y, size: r.size, font: r.font, color: r.color });
    }
  }
  return await doc.save();
}
