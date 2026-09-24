/** OpenAlex returns absolute identifiers; the catalog uses their path. */
export function topicHref(rawId: string, name: string) {
  const id = rawId.replace(/^https?:\/\/openalex\.org\//, "");
  if (/^T\d+$/.test(id)) return `/topics/${id}`;
  const key = id.startsWith("domains/") ? "domain" : id.startsWith("fields/") ? "field" : id.startsWith("subfields/") ? "subfield" : "q";
  return `/topics?${new URLSearchParams({ [key]: key === "q" ? name : id })}`;
}
