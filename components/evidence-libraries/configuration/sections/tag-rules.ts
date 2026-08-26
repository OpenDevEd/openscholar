// Tag rules tell the library which Zotero tags mean "coming soon", "hidden",
// and so on. They live at `content.tags` in the configuration.

export const TAG_RULE_KEYS = [
  "publish",
  "comingSoon",
  "internal",
  "hidden",
  "description",
  "redirects",
] as const;

export type TagRuleKey = (typeof TAG_RULE_KEYS)[number];
export type TagRules = Partial<Record<TagRuleKey, string[]>>;

export const TAG_RULE_LIMITS = { maxTags: 10, maxLength: 128 } as const;

export const DEFAULT_TAG_RULES: Record<TagRuleKey, string[]> = {
  publish: ["_publish", "publishPDF"],
  comingSoon: ["_comingsoon"],
  internal: ["internal"],
  hidden: ["hide"],
  description: ["_category_description"],
  redirects: ["_redirects"],
};

// "a, b ,, c" -> ["a", "b", "c"]; repeated tags are kept once.
export function parseTagList(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(",")) {
    const tag = part.trim();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

export type TagRuleIssue = "publishEmpty" | "tooMany" | "tooLong";

export function tagRuleIssue(key: TagRuleKey, tags: readonly string[]): TagRuleIssue | null {
  if (key === "publish" && tags.length === 0) return "publishEmpty";
  if (tags.length > TAG_RULE_LIMITS.maxTags) return "tooMany";
  if (tags.some((tag) => tag.length > TAG_RULE_LIMITS.maxLength)) return "tooLong";
  return null;
}
