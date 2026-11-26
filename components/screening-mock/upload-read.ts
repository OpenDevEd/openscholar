// What the mock reads from a file or a pasted list in the browser, so its counts are the person's
// own: how many references a file holds, which of a table's columns is which, and the DOIs in a
// text. The product sends a reference file to Zotero's importer; this only counts what one holds.

import Papa from "papaparse";
import { hash, type PdfFile } from "./data";

/** What a reference file holds, counted from its own text. `records` have a title. */
export type FileRead = { format: string; records: number; /** Records with no title, by their place in the file: left out. */ untitled: number[]; /** The titles of the records that have no abstract. */ bare: string[]; withDoi: number };

const DOI = /10\.\d{4,9}\/\S+/;
const BOM = /^\uFEFF/;

/** What a record holds in one of its parts, or nothing. */
type Read = (record: string) => string;
/** A tag's words: what follows it on its line, and the lines after that until the next tag, since a long abstract runs on. `any` is how any tag of the format starts a line. */
const line = (tag: string, any: string): Read => { const from = new RegExp(`^(?:${tag})(.*(?:\\n(?!${any}).*)*)`, "m"); return (record) => record.match(from)?.[1]?.replace(/\s+/g, " ").trim() ?? ""; };
/** An XML element's words, once the markup inside is taken out. */
const element = (name: string): Read => { const whole = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`); return (record) => record.match(whole)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? ""; };
/** A BibTeX field's words, wherever in the entry it sits: between its braces, however deep others sit inside them, between its quotes, or a bare word. `booktitle` is not `title`. */
const field = (name: string): Read => {
  const starts = new RegExp(`(?<![a-z])${name}\\s*=\\s*`, "i");
  return (record) => {
    const found = starts.exec(record);
    if (!found) return "";
    const rest = record.slice(found.index + found[0].length);
    let end = 0;
    if (rest[0] === "{") for (let depth = 0; end < rest.length; end++) { if (rest[end] === "{") depth++; else if (rest[end] === "}" && --depth === 0) break; }
    else end = rest[0] === '"' ? Math.max(1, rest.indexOf('"', 1)) : rest.search(/[,\s})]|$/);
    return rest.slice(0, end).replace(/[{}"]/g, "").replace(/\s+/g, " ").trim();
  };
};

/** A reference format: how its records are parted, and where a record holds its title and its abstract. */
type Format = { name: string; is: RegExp; part: RegExp; record: RegExp; title: Read; abstract: Read };
const FORMATS: Format[] = [
  { name: "PubMed", is: /^PMID-/m, part: /^(?=PMID-)/m, record: /^PMID-/m, title: line("TI {2}-", "[A-Z]{2,4} *-"), abstract: line("AB {2}-", "[A-Z]{2,4} *-") },
  { name: "Web of Science", is: /^(FN |PT [A-Z]\s*$)/m, part: /^ER\s*$/m, record: /^PT /m, title: line("TI ", "[A-Z][A-Z0-9] "), abstract: line("AB ", "[A-Z][A-Z0-9] ") },
  { name: "EndNote XML", is: /<record>/, part: /(?=<record>)/, record: /<record>/, title: element("title"), abstract: element("abstract") },
  // An entry opens with a brace or a bracket, and may sit on one line.
  { name: "BibTeX", is: /^\s*@\w+\s*[{(]/m, part: /^(?=\s*@\w+\s*[{(])/m, record: /^\s*@(?!comment|string|preamble)\w+\s*[{(]/im, title: field("title"), abstract: field("abstract") },
  { name: "EndNote", is: /^%0 /m, part: /^(?=%0 )/m, record: /^%0 /m, title: line("%T ", "%\\S"), abstract: line("%X ", "%\\S") },
  // Last: other formats use two-letter tags too. A record runs to its ER line, and what sits between two records (a number, a provider's header) is no record.
  { name: "RIS", is: /^TY {1,2}- /m, part: /^ER {0,2}-.*$/m, record: /^TY {1,2}- /m, title: line("(?:TI|T1|CT|BT) {1,2}-", "[A-Z][A-Z0-9] {1,2}-"), abstract: line("(?:AB|N2) {1,2}-", "[A-Z][A-Z0-9] {1,2}-") },
];

/** The references in a file's text, or null where it holds none this reads. */
export function readReferences(text: string): FileRead | null {
  const clean = text.replace(BOM, "");
  const format = FORMATS.find((one) => one.is.test(clean));
  if (!format) return null;
  const records = clean.split(format.part).filter((block) => format.record.test(block));
  if (!records.length) return null;
  const titled = records.filter((block) => format.title(block));
  return {
    format: format.name,
    records: titled.length,
    untitled: records.flatMap((block, at) => (format.title(block) ? [] : [at + 1])),
    bare: titled.filter((block) => !format.abstract(block)).map(format.title),
    withDoi: titled.filter((block) => DOI.test(block)).length,
  };
}

/** The parts of a record a table can hold, and the names databases and reference managers give their columns. */
export const COLUMN_KEYS = ["title", "abstract", "doi", "year", "authors"] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];
export const COLUMN_LABEL: Record<ColumnKey, string> = { title: "Title", abstract: "Abstract", doi: "DOI", year: "Year", authors: "Authors" };
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

// What follows is made up, since the mock looks nothing up: each DOI and each PDF gets an outcome
// from its own name, in the shares measured on 1,000 real DOIs and 400 real PDFs (26 Nov 2026).

// The reasons as a row's chip has room for them. The list's "?" says each in full.
export const NOT_A_DOI = "No such DOI";
export const NO_RECORD = "No record of it";
/** A pasted DOI as a lookup leaves it: found, with or without an abstract, or why it wasn't. */
export function doiOutcome(doi: string): { found: true; abstract: boolean } | { found: false; why: string } {
  // A test DOI, which registries hand out and never fill in.
  if (doi.startsWith("10.5072/")) return { found: false, why: NO_RECORD };
  const roll = hash(doi) % 100;
  if (roll < 4) return { found: false, why: NOT_A_DOI };
  if (roll < 7) return { found: false, why: NO_RECORD };
  return { found: true, abstract: roll >= 20 };
}

/** A PDF as reading it leaves it, in the shares measured: by its DOI, by its title, from its own first page, or left out. */
export function pdfOutcome(name: string, paper: number): PdfFile {
  const roll = hash(name) % 100;
  const how: PdfFile["how"] = roll < 43 ? "doi" : roll < 56 ? "title" : roll < 71 ? "file" : roll < 95 ? "abstract" : roll < 99 ? "scan" : "broken";
  return { name, how, paper, own: how === "file" || ((how === "doi" || how === "title") && hash(`${name}:own`) % 100 < 60) };
}
