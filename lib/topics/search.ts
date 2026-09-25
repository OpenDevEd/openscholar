import { topicLevelOf, type TopicLevel } from "@/lib/evidence-libraries/openalex-import-request";
import tree from "./openalex-topics.json";

export type TopicOption = { id: string; name: string; level: TopicLevel; within: string };

const LEVEL_ORDER: Record<TopicLevel, number> = { domain: 0, field: 1, subfield: 2, topic: 3 };
const names = new Map(tree.map((node) => [node.id, node.name]));
// Broadest first, then by name, so equal matches keep that order.
const options: TopicOption[] = tree
  .map((node) => ({
    id: node.id,
    name: node.name,
    level: topicLevelOf(node.id),
    within: (node.parent && names.get(node.parent)) ?? "",
  }))
  .sort(
    (left, right) =>
      LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level] ||
      left.name.localeCompare(right.name),
  );

export function topicName(id: string): string | undefined {
  return names.get(id);
}

/** Finds research areas of every level in our OpenAlex catalog, matching parts of words. */
export function searchTopicCatalog(search: string, limit = 50): TopicOption[] {
  const query = search.trim().toLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  if (!words.length) return options.slice(0, limit);
  const rank = (name: string) =>
    name.startsWith(query) ? 0 : name.includes(` ${query}`) ? 1 : 2;
  return options
    .filter((option) => {
      const name = option.name.toLowerCase();
      return words.every((word) => name.includes(word));
    })
    .sort((left, right) => rank(left.name.toLowerCase()) - rank(right.name.toLowerCase()))
    .slice(0, limit);
}
