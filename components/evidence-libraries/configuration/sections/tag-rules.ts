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

const TAG_RULE_LIMITS = { maxTags: 10, maxLength: 128 } as const;

export const DEFAULT_TAG_RULES: Record<TagRuleKey, string[]> = {
  publish: ["_publish", "publishPDF"],
  comingSoon: ["_comingsoon"],
  internal: ["internal"],
  hidden: ["hide"],
  description: ["_category_description"],
  redirects: ["_redirects"],
};

export type TagRuleIssue = "publishEmpty" | "tooMany" | "tooLong" | "duplicate" | "hiddenClash";

function tagListIssue(tags: readonly string[], needsOne: boolean): TagRuleIssue | null {
  if (needsOne && tags.length === 0) return "publishEmpty";
  if (tags.length > TAG_RULE_LIMITS.maxTags) return "tooMany";
  if (tags.some((tag) => tag.length > TAG_RULE_LIMITS.maxLength)) return "tooLong";
  return null;
}

export function tagRuleIssue(key: TagRuleKey, tags: readonly string[]): TagRuleIssue | null {
  return tagListIssue(tags, key === "publish");
}

/**
 * A Zotero group publishing tagged PDFs needs a publish tag; one publishing every PDF may have none. Like the
 * library, it matches tags without case, so a publish tag can't also be one of `blocked` (the hide and internal tags).
 */
export function pdfPublishingIssue(
  rule: { mode: "tagged" | "every"; tags: readonly string[] },
  blocked: readonly string[],
): TagRuleIssue | null {
  const issue = tagListIssue(rule.tags, rule.mode === "tagged");
  if (issue) return issue;
  if (new Set(rule.tags).size !== rule.tags.length) return "duplicate";
  const lower = new Set(blocked.map((tag) => tag.toLowerCase()));
  return rule.tags.some((tag) => lower.has(tag.toLowerCase())) ? "hiddenClash" : null;
}

/** The tags a publish tag can't also be: the library's hide and internal tags. */
export function blockedPublishTags(tags: TagRules): string[] {
  return [...(tags.hidden ?? DEFAULT_TAG_RULES.hidden), ...(tags.internal ?? DEFAULT_TAG_RULES.internal)];
}
