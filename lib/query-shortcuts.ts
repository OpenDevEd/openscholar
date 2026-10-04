/**
 * Query shortcuts (the Bookmarks page): `name...` in a query expands to the shortcut's
 * text. Pure, so the browser expands from its store and the server from the account's
 * Convex records, to the same query.
 */
const SHORTCUT = /(\w[\w-]*)\.\.\./g;

/** A name as it is typed: a space becomes a dash, and what a name can't hold is dropped. */
export function typedShortcutName(value: string) {
  return value.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
}

/** The name as it is saved: it starts and ends with a letter or number. */
export function savedShortcutName(typed: string) {
  return typed.replace(/^-+|-+$/g, "");
}

/** Each shortcut name a query uses, once. */
export function shortcutNames(query: string): string[] {
  return [...new Set(Array.from(query.matchAll(SHORTCUT), (match) => match[1]))];
}

/** A shortcut's expansion by name. */
export type ShortcutExpansions = Readonly<Record<string, string | undefined>>;
export type ShortcutWarning = { key: string; params?: Record<string, string> };

/** The query with each known shortcut expanded, and a warning for each unknown one. */
export function expandShortcuts(query: string, expansions: ShortcutExpansions): { expandedQuery: string; warnings: ShortcutWarning[] } {
  const warnings: ShortcutWarning[] = [];
  const expandedQuery = query.replace(SHORTCUT, (match, keyword: string) => {
    // Only a shortcut the person saved: not `constructor` and the like from the object's prototype.
    const expansion = Object.prototype.hasOwnProperty.call(expansions, keyword) ? expansions[keyword] : undefined;
    if (typeof expansion === "string" && expansion) return expansion;
    warnings.push({ key: "bookmarkNotFound", params: { keyword } });
    return match;
  });
  return { expandedQuery, warnings };
}

/** How shortcuts sort on the Bookmarks page: by name, whatever its case. */
export function shortcutSortName(name: string) {
  return name.toLowerCase();
}
