// The references a pasted text or an uploaded file holds, for the References box on a report's details.
// A BibTeX or RIS file gives one reference a record, written out in APA; any other text gives one a line, or one a
// block when blank lines part them. Loaded when someone adds references, since it brings the citation styles with it.

import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-ris";
import { formatCitation } from "@/lib/citations/formatter";
import type { CitationData } from "@/lib/citations/formats";
import { doiWithin, referenceFrom, type Reference } from "./report";

/** A list's own numbering, which the box numbers again: "[12]", "12." or "12)". */
const NUMBER = /^\s*(?:\[\d+\]|\d+[.)])\s+/;

function fromRecords(text: string): Reference[] | null {
  if (!/^\s*@\w+\s*\{/m.test(text) && !/^TY {2}- /m.test(text)) return null;
  try {
    const records = new Cite(text).data as (Partial<CitationData> & { DOI?: string })[];
    return records.map((record, at) => {
      const data = { ...record, id: record.id ?? `ref${at}`, type: record.type ?? "document", title: record.title ?? "", "citation-key": record["citation-key"] ?? `ref${at}` } as CitationData;
      const doi = typeof record.DOI === "string" ? doiWithin(record.DOI) : undefined;
      return { text: formatCitation(data, "en", "apa").text.replace(/\s+/g, " ").trim(), ...(doi && { doi }) };
    });
  } catch {
    // A file that only looks like one of the two is read as its lines.
    return null;
  }
}

function fromLines(text: string): Reference[] {
  const blocks = text.trim().split(/\n\s*\n/);
  // Blank lines part the references of a list copied from a PDF, which wraps each over several lines: a block's lines
  // are then one reference, unless a line carries a number of its own or a second DOI. Without blank lines, every line
  // is a reference.
  const wrapped = blocks.length > 1;
  const starts = (line: string, last: string | undefined) => !wrapped || last === undefined || NUMBER.test(line) || (!!doiWithin(line) && !!doiWithin(last));
  const lines = blocks.flatMap((block) =>
    block.split("\n").map((line) => line.trim()).filter(Boolean).reduce<string[]>((found, line) => (starts(line, found.at(-1)) ? [...found, line] : [...found.slice(0, -1), `${found.at(-1)} ${line}`]), []),
  );
  return lines.flatMap((numbered) => referenceFrom(numbered.replace(NUMBER, "")) ?? []);
}

/** The references in `text`: a BibTeX or RIS file's records, or a plain list's lines. */
export const referencesIn = (text: string): Reference[] => fromRecords(text) ?? fromLines(text);
