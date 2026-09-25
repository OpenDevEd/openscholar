/** OpenAlex's own values for the filters that use them. Names are OpenAlex data, like topic names. */

export const SDGS = [
  "No poverty", "Zero hunger", "Good health and well-being", "Quality education",
  "Gender equality", "Clean water and sanitation", "Affordable and clean energy",
  "Decent work and economic growth", "Industry, innovation and infrastructure",
  "Reduced inequalities", "Sustainable cities and communities",
  "Responsible consumption and production", "Climate action", "Life below water",
  "Life on land", "Peace, justice and strong institutions", "Partnerships for the goals",
].map((name, index) => ({ id: String(index + 1), name: `${index + 1}. ${name}` }));

/** Work types from api.openalex.org/types, most common first. */
export const WORK_TYPES = [
  ["article", "Article"], ["dataset", "Dataset"], ["book-chapter", "Book chapter"],
  ["conference-paper", "Conference paper"], ["dissertation", "Dissertation"],
  ["preprint", "Preprint"], ["book", "Book"], ["report", "Report"], ["review", "Review"],
  ["reference-entry", "Reference entry"], ["conference-abstract", "Conference abstract"],
  ["book-review", "Book review"], ["peer-review", "Peer review"], ["editorial", "Editorial"],
  ["letter", "Letter"], ["standard", "Standard"], ["software", "Software"],
  ["data-paper", "Data paper"], ["software-paper", "Software paper"],
  ["supplementary-materials", "Supplementary materials"], ["erratum", "Erratum"],
  ["retraction", "Retraction"], ["libguides", "Library guide"], ["paratext", "Paratext"],
  ["other", "Other"],
].map(([id, name]) => ({ id, name }));

export type TopicLevel = "domain" | "field" | "subfield" | "topic";

/** Research area ids carry their level: "fields/33", "subfields/3304", "T13958". */
export function topicLevelOf(id: string): TopicLevel {
  return id.startsWith("T") ? "topic" : (id.split("/")[0].slice(0, -1) as TopicLevel);
}

/**
 * Research areas as OpenAlex `topics` filter values, one per level. OpenAlex
 * ORs the values of one filter and ANDs different filters, so areas in one
 * level widen the search and areas in different levels must all match.
 */
function researchAreasByLevel(ids: readonly string[]): [TopicLevel, string][] {
  const byLevel = new Map<TopicLevel, string[]>();
  for (const id of ids) {
    const level = topicLevelOf(id);
    byLevel.set(level, [...(byLevel.get(level) ?? []), id.split("/").at(-1)!]);
  }
  return [...byLevel].map(([level, values]) => [level, values.join("|")]);
}

/** The `topics` filter in the SDK's nested form. */
export function researchAreaFilter(ids: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    researchAreasByLevel(ids).map(([level, value]) =>
      level === "topic" ? ["id", value] : [level, { id: value }],
    ),
  );
}

/** The same filter as query-string clauses, such as `topics.subfield.id:3304|1702`. */
export function researchAreaClauses(ids: readonly string[]): string[] {
  return researchAreasByLevel(ids).map(([level, value]) =>
    level === "topic" ? `topics.id:${value}` : `topics.${level}.id:${value}`,
  );
}

export const sdgFilterValue = (goals: readonly string[]) =>
  goals.map((goal) => `https://metadata.un.org/sdg/${goal}`).join("|");
