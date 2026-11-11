import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-ris";
import { CITATION_FILES, type CitationData, type CitationFile } from "./formats";

/**
 * A paper as the file a reference manager imports, named as people name the paper: first author and year, such as
 * datoo-2021.ris. Kept apart from the formatter so writing a file never loads the citation-style engine.
 */
export function citationFile(data: CitationData, kind: CitationFile) {
	const file = CITATION_FILES[kind];
	// A report's number in its series is CSL's `collection-number`, which the formatted styles print after the series
	// ("Openscholar Reports R100022"). BibTeX's `number` comes only from CSL's `number`, so the file carries it as that.
	const number = data["collection-number"];
	const exported = number && !data.number ? { ...data, number } : data;
	const made = new Cite([exported]).format(file.format, { format: "text" }).trim();
	// Citation.js breaks an RIS value every 70 characters, mid-word: reference managers join the pieces with a space
	// ("accep tance"). RIS takes a value of any length on one line, so each piece goes back on its tag's line.
	const text = kind === "ris" ? made.replace(/\r?\n(?![A-Z][A-Z0-9] {2}-(?: |$))/g, "") : made;
	const author = (data.author as { family?: string; literal?: string }[] | undefined)?.[0];
	const year = (data.issued as { "date-parts"?: number[][] } | undefined)?.["date-parts"]?.[0]?.[0];
	const stem = [author?.family ?? author?.literal?.split(" ").at(-1), year].filter(Boolean).join(" ").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
	return { text, name: `${stem || "citation"}.${file.extension}`, type: file.type };
}
