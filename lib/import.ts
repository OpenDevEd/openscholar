import Papa from "papaparse";
import type { JsonValue } from "./utils";

/** Parse file structure without guessing types or changing the search text. */
export function parseImportFile(content: string, format: "json" | "csv"): Record<string, JsonValue>[] {
  let data: unknown;
  if (format === "csv") {
    const parsed = Papa.parse<Record<string, string>>(content.replace(/^\ufeff/, ""), { header: true, skipEmptyLines: "greedy" });
    if (parsed.errors.length) throw new Error(`Invalid CSV: ${parsed.errors[0].message}`);
    if ("renamedHeaders" in parsed.meta && parsed.meta.renamedHeaders && Object.keys(parsed.meta.renamedHeaders).length) throw new Error("CSV headers must be unique");
    data = parsed.data;
  } else {
    data = JSON.parse(content.replace(/^\ufeff/, ""));
    if (data && typeof data === "object" && "format" in data) {
      if (data.format !== "openscholar.searches" || !("version" in data) || data.version !== 1) throw new Error("Unsupported search export format or version");
      data = "searches" in data ? data.searches : undefined;
    } else if (!Array.isArray(data)) data = [data];
  }
  if (!Array.isArray(data) || data.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("The file must contain records with named fields");
  return data as Record<string, JsonValue>[];
}
