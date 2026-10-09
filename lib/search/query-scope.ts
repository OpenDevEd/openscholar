import { OQL_FIELD } from "@/lib/openalex/oql";
import { SEMANTIC_FIELD } from "@/lib/openalex/semantic";

/** What a search field's query is written as: OQL, a question asked by meaning, or keywords. */
export type QueryScope = "oql" | "semantic" | "keywords";

export function queryScope(field: string | undefined): QueryScope {
  if (field === OQL_FIELD) return "oql";
  return field === SEMANTIC_FIELD ? "semantic" : "keywords";
}
