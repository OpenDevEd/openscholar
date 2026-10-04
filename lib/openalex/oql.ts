/** Search Scope value that sends the query box as OpenAlex Query Language. */
export const OQL_FIELD = "oql";

export const OQL_REFERENCE_URL = "https://help.openalex.org/access/oql/";

const SDG_PREFIX = "https://metadata.un.org/sdg/";

/**
 * Nested filters as OpenAlex paths, `{topics: {id: "T1"}}` to `topics.id: ["T1"]`.
 * Same output as the SDK's `getPaths`, whose module also loads its HTTP client.
 */
export function filterPaths(value: object, path: string[] = [], result: Record<string, unknown[]> = {}) {
  for (const [key, item] of Object.entries(value)) {
    const next = [...path, key];
    for (const entry of Array.isArray(item) ? item : [item]) {
      if (typeof entry === "object" && entry !== null) filterPaths(entry, next, result);
      else (result[next.join(".")] ??= []).push(entry);
    }
  }
  return result;
}

/**
 * The typed query's filter part, without the `works where` OpenAlex's examples
 * start with, and any trailing `sample N seed N`, which must stay outside the
 * filters when more clauses are added.
 */
export function splitOql(query: string): { where: string; sample: string } {
  const match = query.trim().match(/^(?:works\b\s*(?:where\b)?)?\s*([\s\S]*?)\s*(sample\s+\d+(?:\s+seed\s+\d+)?)?$/i);
  return { where: match?.[1] ?? "", sample: match?.[2] ?? "" };
}

/** Adds clauses to a typed query, keeping its sample at the end. */
export function joinOql(query: string, clauses: string[]): string {
  const { where, sample } = splitOql(query);
  const all = [...(where ? [`(${where})`] : []), ...clauses];
  return [all.length ? `works where ${all.join(" and ")}` : "works", sample].filter(Boolean).join(" ");
}

/** The sidebar's API filters as OQL clauses. OQL takes the API's column ids as field names. */
export function oqlClauses(filter: object): string[] {
  return Object.entries(filterPaths(filter)).map(([column, values]) => {
    const list = values.flatMap((value) => String(value).split("|"));
    // The API writes at least N citations as `cited_by_count:>N-1`, a comparison in OQL.
    if (column === "cited_by_count") return `cited_by_count > (${list[0].replace(/^>/, "")})`;
    const ids = column === "sustainable_development_goals.id" ? list.map((goal) => goal.replace(SDG_PREFIX, "")) : list;
    // A search column takes `has`; OpenAlex refuses `is` on one.
    return `${column} ${column.endsWith(".search") ? "has" : "is"} (${ids.join(" or ")})`;
  });
}

/** One OQL query from the typed query and the sidebar's filters. */
export function worksOql(query: string, filter: object = {}): string {
  return joinOql(query, oqlClauses(filter));
}
