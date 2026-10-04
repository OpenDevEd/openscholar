import { topicLevelOf, type TopicLevel } from "@/lib/openalex/vocabulary";
import tree from "./openalex-topics.json";
import type { TopicNode } from "./contract";

/** `path` holds the ancestors' names, broadest first, a repeated name once. */
export type TopicOption = { id: string; name: string; level: TopicLevel; path: string[] };

const LEVEL_ORDER: Record<TopicLevel, number> = { domain: 0, field: 1, subfield: 2, topic: 3 };
const nodes = new Map(tree.map((node) => [node.id, node]));
const ancestors = (parent: string | null): string[] => {
  const node = parent ? nodes.get(parent) : undefined;
  if (!node) return [];
  const above = ancestors(node.parent);
  return above.at(-1) === node.name ? above : [...above, node.name];
};
// Broadest first, then by name, so equal matches keep that order.
const options: TopicOption[] = tree
  .map((node) => ({
    id: node.id,
    name: node.name,
    level: topicLevelOf(node.id),
    path: ancestors(node.parent),
  }))
  .sort(
    (left, right) =>
      LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level] ||
      left.name.localeCompare(right.name),
  );

export function topicName(id: string): string | undefined {
  return nodes.get(id)?.name;
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

const children = new Map<string | null, string[]>();
for (const node of tree) children.set(node.parent, [...(children.get(node.parent) ?? []), node.id]);
const lineage = (id: string): string[] => {
  const node = nodes.get(id);
  return node ? [...(node.parent ? lineage(node.parent) : []), id] : [];
};

/** A catalog node as the platform serves it; `path` holds every name from the domain down to it. */
export function catalogNode(id: string): TopicNode | undefined {
  const node = nodes.get(id);
  if (!node) return undefined;
  return {
    id,
    name: node.name,
    parent: node.parent,
    level: topicLevelOf(id),
    path: lineage(id).map((line) => nodes.get(line)!.name),
    childCount: children.get(id)?.length ?? 0,
  };
}

/** The node's ancestors, broadest first. */
export function catalogAncestors(id: string): TopicNode[] {
  return lineage(id).slice(0, -1).map((line) => catalogNode(line)!);
}

/** The areas directly under `parent`, or the domains for null, by name. */
export function catalogChildren(parent: string | null): TopicNode[] {
  return (children.get(parent) ?? [])
    .map((id) => catalogNode(id)!)
    .sort((left, right) => left.name.localeCompare(right.name));
}

const topics = tree
  .filter((node) => topicLevelOf(node.id) === "topic")
  .map((node) => catalogNode(node.id)!)
  .sort((left, right) => left.name.localeCompare(right.name))
  .map((topic) => ({ topic, ancestors: new Set(lineage(topic.id)), text: `${topic.path.join(" ")} ${topic.id}`.toLowerCase() }));

/** Topics under `ancestor` whose names, their areas' names or ID hold every word; names that start with the search first. */
export function searchCatalogTopics(search: string, ancestor?: string): TopicNode[] {
  const query = search.trim().toLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  const rank = (name: string) => (name.toLowerCase().startsWith(query) ? 0 : name.toLowerCase().includes(query) ? 1 : 2);
  const matches = topics
    .filter((entry) => (!ancestor || entry.ancestors.has(ancestor)) && words.every((word) => entry.text.includes(word)))
    .map(({ topic }) => topic);
  return words.length ? matches.sort((left, right) => rank(left.name) - rank(right.name)) : matches;
}
