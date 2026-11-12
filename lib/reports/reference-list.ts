// The references a pasted text or an uploaded file holds, for the References box on a report's details.
// A BibTeX or RIS file gives one reference a record, written out in APA; any other text gives one a line, or one a
// block when blank lines part them. Loaded when someone adds references, since it brings the citation styles with it.

import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-ris";
import { formatCitation } from "@/lib/citations/formatter";
import type { CitationData } from "@/lib/citations/formats";
import type { Reference } from "./report";

// The real build shares this with the reader (convex/reports/reader.ts), which finds DOIs in a PDF's list the same way.
const DOI = /10\.\d{4,9}\/[^\s"<>]+/;
const doiWithin = (text: string) => text.match(DOI)?.[0].replace(/[.,;)\]]+$/, "").toLowerCase();
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
  // are then one reference, unless a line carries a number of its own. Without blank lines, every line is a reference.
  const wrapped = blocks.length > 1;
  const lines = blocks.flatMap((block) =>
    block.split("\n").map((line) => line.trim()).filter(Boolean).reduce<string[]>((found, line) => (!wrapped || NUMBER.test(line) || !found.length ? [...found, line] : [...found.slice(0, -1), `${found.at(-1)} ${line}`]), []),
  );
  return lines.flatMap((numbered) => {
    const line = numbered.replace(/\s+/g, " ").replace(NUMBER, "").trim();
    if (!line) return [];
    const doi = doiWithin(line);
    // A line that is a DOI and nothing else, as an address or bare, is kept as the DOI alone.
    const bare = doi && line.toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "").replace(/[.,;]+$/, "") === doi;
    return [bare ? { text: "", doi } : { text: line, ...(doi && { doi }) }];
  });
}

/** The references in `text`: a BibTeX or RIS file's records, or a plain list's lines. */
export const referencesIn = (text: string): Reference[] => fromRecords(text) ?? fromLines(text);
