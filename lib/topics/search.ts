import type { OpenAlexTopicLevel } from "@/lib/evidence-libraries/openalex-source-query";
import tree from "./openalex-topics.json";

export type TopicOption = { id: string; name: string; within: string };

const names = new Map(tree.map((node) => [node.id, node.name]));
const byLevel = Object.fromEntries(
  (["field", "subfield", "topic"] as const).map((level) => {
    const prefix = level === "topic" ? "T" : `${level}s/`;
    const options = tree
      .filter((node) => node.id.startsWith(prefix))
      .map((node) => ({
        id: node.id.split("/").at(-1)!,
        name: node.name,
        within: (node.parent && names.get(node.parent)) ?? "",
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return [level, options];
  }),
) as Record<OpenAlexTopicLevel, TopicOption[]>;

/** Finds research areas in our OpenAlex catalog, matching parts of words. */
export function searchTopicCatalog(
  level: OpenAlexTopicLevel,
  search: string,
  limit = 50,
): TopicOption[] {
  const query = search.trim().toLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  if (!words.length) return byLevel[level].slice(0, limit);
  const rank = (name: string) =>
    name.startsWith(query) ? 0 : name.includes(` ${query}`) ? 1 : 2;
  return byLevel[level]
    .filter((option) => {
      const name = option.name.toLowerCase();
      return words.every((word) => name.includes(word));
    })
    .sort((left, right) => rank(left.name.toLowerCase()) - rank(right.name.toLowerCase()))
    .slice(0, limit);
}
