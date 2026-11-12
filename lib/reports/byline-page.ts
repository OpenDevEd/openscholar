import { PDFDocument, StandardFonts, rgb, type PDFFont } from "@cantoo/pdf-lib";
import { LICENCE_URL, dateMoment, dateStyleOf, type Metadata } from "./report";

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

/** `text` in lines no wider than `width`. A word wider than that, as a long name with no spaces, is broken where it runs out of room. */
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const fits = (words: string) => font.widthOfTextAtSize(words, size) <= width;
  const lines: string[] = [];
  for (let word of text.split(/\s+/).filter(Boolean)) {
    let broken = false;
    while (word.length > 1 && !fits(word)) {
      let cut = word.length - 1;
      while (cut > 1 && !fits(word.slice(0, cut))) cut -= 1;
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
      broken = true;
    }
    const tried = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
    // The rest of a broken word starts its own line: a space set into it would read as two words.
    if (lines.length && !broken && fits(tried)) lines[lines.length - 1] = tried;
    else lines.push(word);
  }
  return lines;
}

/** The PDF without its last page: a report's own pages, when the last is the one Openscholar added. */
export async function withoutLastPage(pdf: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  if (doc.getPageCount() > 1) doc.removePage(doc.getPageCount() - 1);
  return await doc.save();
}

/**
 * The PDF with one more page at its end, for an author who has Openscholar add the byline: the series, the report's
 * title, authors, date, licence and publisher, and the byline itself, as text. The page takes the last page's size and
 * orientation as a reader sees it, or one large enough for what it says when that page is smaller; on a larger page
 * the text grows with it. The date is written as precisely as the report states it. Nothing else in the PDF changes. With
 * `replaceLast`, the page takes the place of the one added before, as when the details have changed since.
 * Throws for a PDF pdf-lib can't open. The byline is always written; a title or a name Helvetica can't write
 * (anything outside Latin script) is left out.
 */
// ponytail: pdf-lib holds the whole PDF in memory to add one page, so callers keep to BYLINE_PAGE_MAX_BYTES
// (lib/reports/report.ts). Write the page as an incremental update to the file to lift that. Embed a Unicode font
// when reports in other scripts need their title on this page.
export async function withBylinePage(pdf: Uint8Array, { line, series, details }: BylinePage, { replaceLast = false } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  if (replaceLast && doc.getPageCount() > 1) doc.removePage(doc.getPageCount() - 1);
  // The last page as it shows: one stored upright and turned a quarter by its rotation reads the other way round.
  const lastPage = doc.getPage(doc.getPageCount() - 1);
  const stored = lastPage.getSize();
  const turned = lastPage.getRotation().angle % 180 !== 0;
  const last = turned ? { width: stored.height, height: stored.width } : stored;
  const plain = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // The text keeps its size to the page: an A4 page's shorter side, 595 points, writes it at its own size, and a
  // larger page, such as a slide made at 1920 by 1080, writes it larger.
  const scale = Math.max(1, Math.min(last.width, last.height) / 595);
  // Wide enough for a DOI's address on one line.
  const width = Math.max(last.width, 420);
  const margin = Math.min(72 * scale, width / 8);
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
  const row = (text: string | undefined, font: PDFFont, size: number, gap: number, color = INK): Row[] => (text?.trim() && writable(text) ? [{ text: text.trim(), font, size: size * scale, color, gap: gap * scale }] : []);
  // As the report states it: 2026, October 2026 or 11 October 2026, never a month or a day it doesn't give.
  const dated = details?.date ? dateMoment(details.date) : null;
  const when = dated ? new Intl.DateTimeFormat("en-GB", dateStyleOf(dated.parts)).format(dated.at) : details?.date;
  const names = details?.authors.map((author) => author.name.trim()).filter(Boolean).join(", ");
  const rows = [
    ...row(series, bold, 14, 0),
    ...row(details?.title, bold, 12, 22),
    ...row(details?.subtitle, plain, 11, 4),
    ...row(names, plain, 11, 10),
    ...row(when, plain, 10, 4, MUTED),
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
