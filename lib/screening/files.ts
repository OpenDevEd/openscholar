// What a person hands a screening as a file or a pasted list, read the same in the browser and on the
// server (plans/screening-reviewers): which of a table's columns is which and the records its rows
// give, the records a reference file holds once Zotero's importer has read it, and the DOIs in a text.

import Papa from "papaparse";

/** A record of a file as a screening takes it: what its source said of the paper, before the index is asked. */
export type FileRecord = { title: string; abstract?: string; authors?: string[]; publicationYear?: number; doi?: string; venue?: string; /** The kind of work the file says it is (Zotero's item type: book, thesis, report…), which a reference manager files it as. */ workType?: string };

const DOI = /10\.\d{4,9}\/\S+/;
const BOM = /^\uFEFF/;
/** The most a file a screening reads may weigh: what Zotero's importer takes in one request. */
/**
 * A PDF's first page's height for its width, as it shows: a page turned a quarter is as tall as it was wide. Kept with
 * the paper, so its pages hold their room at their own shape before the file is read (components/screening/paper-pdf.tsx).
 */
/** A page's height for its width where a file's own is not known: A4's. */
export const A4_SHAPE = 1.414;
type Box = { x: number; y: number; width: number; height: number };
export const pageShapeOf = (pdf: { getPage: (at: number) => { getCropBox: () => Box; getMediaBox: () => Box; getRotation: () => { angle: number } } }) => {
  const page = pdf.getPage(0);
  // What a viewer draws (pdf.js) is the page's crop box within its media box: the file may cut the page smaller.
  const [crop, media] = [page.getCropBox(), page.getMediaBox()];
  const width = Math.min(crop.x + crop.width, media.x + media.width) - Math.max(crop.x, media.x);
  const height = Math.min(crop.y + crop.height, media.y + media.height) - Math.max(crop.y, media.y);
  const turned = Math.abs(page.getRotation().angle) % 180 === 90;
  return width > 0 && height > 0 ? Math.round((turned ? width / height : height / width) * 1000) / 1000 : undefined;
};

export const FILE_MAX_BYTES = 5 * 1024 * 1024;
/** How a reference file starts one of its records, in the formats databases and reference managers export: RIS, PubMed, EndNote, Web of Science, EndNote XML and BibTeX. A file with none of these is read as a table. */
export const REFERENCES = /^(?:TY {1,2}- |PMID-|%0 |FN |PT [A-Z]\s*$)|<record>|^\s*@\w+\s*[{(]/m;

/** The parts of a record a table can hold, and the names databases and reference managers give their columns. */
export const COLUMN_KEYS = ["title", "abstract", "doi", "year", "authors"] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];
const KNOWN: Record<ColumnKey, string[]> = {
  title: ["title", "primary_title", "article title", "document title", "ti"],
  abstract: ["abstract", "abstract note", "notes_abstract", "abstract_text", "ab"],
  doi: ["doi", "di", "digital object identifier"],
  year: ["year", "publication year", "publication_year", "published year", "pub year", "py", "date"],
  authors: ["authors", "author", "author names", "author full names", "author/s", "first_authors", "au"],
};
const EVERY_KNOWN = new Set(Object.values(KNOWN).flat());
/** Words that make a column a likely holder of each part: a guess the person confirms. */
const LIKELY: Record<ColumnKey, RegExp> = { title: /title/i, abstract: /abstract|summary/i, doi: /\bdoi\b/i, year: /year/i, authors: /author/i };

export type TableRead = { heads: string[]; rows: Array<Record<string, string>>; /** Each part's column: by a name it knows, else a likely one, else none. */ picked: Partial<Record<ColumnKey, string>>; /** Whether a person has to say which column is which: no title column by a known name, or an abstract column it only guessed. */ ask: boolean };

/**
 * A table's columns and rows, or null where it holds no table of references. Its heading row is the
 * first whose cells are column names it knows, since some exports put a few lines above it. A cell of
 * a record that happens to say "title" is not a heading: failing a known name, the first row is the
 * heading. One column is a table only when that column is the titles.
 */
export function readTable(text: string): TableRead | null {
  const lines = Papa.parse<string[]>(text.replace(BOM, ""), { skipEmptyLines: "greedy", delimitersToGuess: [",", "\t", ";", "|"] }).data;
  const at = Math.max(0, lines.slice(0, 20).findIndex((cells) => cells.some((cell) => EVERY_KNOWN.has(cell.trim().toLowerCase()))));
  const head = lines[at]?.map((cell) => cell.trim()) ?? [];
  const heads = head.filter(Boolean);
  const rows = lines.slice(at + 1).filter((cells) => cells.some((cell) => cell.trim())).map((cells) => Object.fromEntries(head.map((name, column) => [name, (cells[column] ?? "").trim()])));
  const known = (key: ColumnKey) => heads.find((name) => KNOWN[key].includes(name.toLowerCase()));
  const likely = (key: ColumnKey) => heads.find((name) => LIKELY[key].test(name));
  if (!rows.length || (heads.length < 2 && !known("title") && !likely("title"))) return null;
  const picked = Object.fromEntries(COLUMN_KEYS.flatMap((key) => { const name = known(key) ?? likely(key); return name ? [[key, name]] : []; })) as TableRead["picked"];
  return { heads, rows, picked, ask: !known("title") || (!known("abstract") && Boolean(likely("abstract"))) };
}

/** What a table's rows give once its columns are named. */
export function tableCounts(table: Pick<TableRead, "rows">, picked: TableRead["picked"]) {
  const has = (row: Record<string, string>, key: ColumnKey) => Boolean(picked[key] && row[picked[key]!]?.trim());
  const titled = table.rows.filter((row) => has(row, "title"));
  return {
    records: titled.length,
    untitled: table.rows.flatMap((row, at) => (has(row, "title") ? [] : [at + 1])),
    bare: titled.filter((row) => !has(row, "abstract")).map((row) => row[picked.title!]!.trim()),
    withDoi: titled.filter((row) => picked.doi && DOI.test(row[picked.doi] ?? "")).length,
  };
}

/** What can open before a DOI: a bracket or a quote, then doi.org's address or "doi:". */
const DOI_START = String.raw`[(\[{<"']*(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)?10\.\d{4,9}\/`;
const BETWEEN = new RegExp(`[,;](?=${DOI_START})`, "i");
/** Each closing bracket with the one that opens it. */
const OPENS: Record<string, string> = { ")": "(", "]": "[", "}": "{", ">": "<" };
const times = (text: string, char: string) => text.split(char).length - 1;
/**
 * Every DOI in a pasted text, as often as it is there. A word is decoded first, so a separator written
 * as a percent code parts DOIs too. A comma or semicolon parts two DOIs only where a new one starts
 * after it, so a DOI that holds one keeps it. A closing bracket belongs to the DOI only when it has
 * its opening one.
 */
function everyDoi(text: string): string[] {
  const found: string[] = [];
  for (const word of text.split(/\s+/)) {
    let decoded = word;
    try { decoded = decodeURIComponent(word); } catch { /* A stray percent sign: read it as it is. */ }
    for (const piece of decoded.split(BETWEEN)) {
      let doi = piece.match(DOI)?.[0];
      if (!doi) continue;
      for (let before = ""; before !== doi; ) {
        before = doi;
        doi = doi.replace(/[.,;:'"’”]+$/, "");
        const last = doi.at(-1) ?? "";
        if (OPENS[last] && times(doi, OPENS[last]) < times(doi, last)) doi = doi.slice(0, -1);
      }
      found.push(doi.toLowerCase());
    }
  }
  return found;
}
/** The DOIs in a pasted text, once each, and how many of them were pasted more than once. */
export function doisIn(text: string) {
  const every = everyDoi(text);
  const dois = [...new Set(every)];
  return { dois, repeats: every.length - dois.length };
}

const yearOf = (text: string | undefined) => { const year = Number(text?.match(/\b(1[5-9]\d{2}|20\d{2})\b/)?.[1]); return Number.isInteger(year) ? year : undefined; };
/** A record with the parts it has. Its title stays where it has none: a record with no title is left out by name, and one with no title key is refused whole. */
const kept = ({ title, ...rest }: FileRecord): FileRecord => ({ title, ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined && value !== "" && !(Array.isArray(value) && !value.length))) });

/** A table's rows as records, once its columns are named. A row with no title is still a record: the screening leaves it out, and says so. */
export function tableRecords(table: Pick<TableRead, "rows">, picked: TableRead["picked"]): FileRecord[] {
  const cell = (row: Record<string, string>, key: ColumnKey) => (picked[key] ? row[picked[key]!]?.trim() : undefined) || undefined;
  return table.rows.map((row) => kept({ title: cell(row, "title") ?? "", abstract: cell(row, "abstract"), authors: cell(row, "authors")?.split(/\s*(?:;|\band\b|\|)\s*/).filter(Boolean), publicationYear: yearOf(cell(row, "year")), doi: cell(row, "doi")?.match(DOI)?.[0] }));
}

/** One item as Zotero's importer gives it (zotero/translation-server, POST /import). */
/** A Zotero item's type as a reference file names it: a thesis its type calls a master's is one, else Zotero's own type. File imports and a connected Zotero both read it here. */
export const workTypeOf = (itemType: string, thesisType?: string) => (itemType === "thesis" && /master|msc|m\.?a\b|m\.?s\b/i.test(thesisType ?? "") ? "mastersThesis" : itemType);

export type ImportedItem = { itemType?: string; title?: string; abstractNote?: string; creators?: Array<{ firstName?: string; lastName?: string; name?: string; creatorType?: string }>; thesisType?: string; date?: string; DOI?: string; publicationTitle?: string; bookTitle?: string; proceedingsTitle?: string };

/** The records a reference file holds, from what Zotero's importer read in it. Notes and attached files are no records, and neither is an item with nothing in it: Ovid ends each record with a line the importer reads as one. */
export function itemRecords(items: ImportedItem[]): FileRecord[] {
  return items
    .filter((item) => item.itemType !== "note" && item.itemType !== "attachment" && Boolean(item.title?.trim() || item.abstractNote?.trim() || item.DOI || item.creators?.length))
    .map((item) => kept({
      title: item.title?.trim() ?? "",
      abstract: item.abstractNote?.trim(),
      // Its authors, as a connected Zotero library gives them: an editor or a translator is no author. A creator with no role given is one.
      authors: item.creators?.filter((one) => !one.creatorType || one.creatorType === "author").map((one) => (one.name ?? [one.firstName, one.lastName].filter(Boolean).join(" ")).trim()).filter(Boolean),
      publicationYear: yearOf(item.date),
      doi: item.DOI?.match(DOI)?.[0],
      venue: (item.publicationTitle ?? item.bookTitle ?? item.proceedingsTitle)?.trim(),
      ...(item.itemType ? { workType: workTypeOf(item.itemType, item.thesisType) } : {}),
    }));
}

