/**
 * Links in the navigation bar and the footer.
 *
 * The runtime stores one `href` per link. The page shows it as a target:
 * a built-in page, a collection, or an external address. These helpers
 * convert between the two shapes.
 */

import schema from "./generated/library-config.schema.json";
import { resolveSchemaPointer } from "./section-registry";

/** Pages every Evidence Library has, with their runtime paths. */
export const BUILT_IN_PAGES = [
  { key: "home", path: "/" },
  { key: "library", path: "/lib" },
  { key: "map", path: "/map" },
  { key: "contact", path: "/contact" },
  { key: "privacy", path: "/privacy" },
  { key: "cookiePolicy", path: "/cookie-policy" },
  { key: "terms", path: "/terms" },
  { key: "takedown", path: "/takedown" },
] as const;
export type BuiltInPageKey = (typeof BUILT_IN_PAGES)[number]["key"];

// The library page filters by `?collections=<key>` (new-el `src/lib/searchParams.tsx`).
const LIBRARY_PATH = "/lib";
const COLLECTIONS_PARAM = "collections";

export type NavIcon =
  | "AboutUs"
  | "EvidenceLibrary"
  | "Programs"
  | "Blog"
  | "Team"
  | "ContactUs"
  | "TeamFill"
  | "ToolsFill"
  | "BookOpenFill"
  | "Bookshelf"
  | "ChatRightDotsFill"
  | "BsMapFill"
  | "LuX"
  | "FaQuestionCircle"
  | "IoStatsChart";

/** Icon ids the runtime accepts, read from the pinned schema. */
export const NAV_ICONS: readonly NavIcon[] = (() => {
  const node = resolveSchemaPointer(schema, "/navigation/links/*/icon") as
    | { anyOf?: { enum?: string[] }[] }
    | undefined;
  const values = node?.anyOf?.find((option) => Array.isArray(option.enum))?.enum;
  if (!values || values.length === 0) {
    throw new Error("Configuration schema has no navigation icon choices");
  }
  return values as NavIcon[];
})();

export type LinkTarget =
  | { kind: "page"; page: BuiltInPageKey }
  | { kind: "collection"; collectionId: string }
  | { kind: "url"; url: string };

export type LinkDraft = {
  id: string;
  label: string;
  target: LinkTarget;
  icon: NavIcon | "";
  newTab: boolean;
  visible: boolean;
  children: LinkDraft[];
};

export const HTTPS_URL = /^https:\/\/\S+$/;

export function collectionHref(collectionId: string): string {
  return `${LIBRARY_PATH}?${COLLECTIONS_PARAM}=${encodeURIComponent(collectionId)}`;
}

export function hrefFor(target: LinkTarget): string {
  switch (target.kind) {
    case "page":
      return BUILT_IN_PAGES.find((page) => page.key === target.page)?.path ?? "/";
    case "collection":
      return collectionHref(target.collectionId);
    case "url":
      return target.url;
  }
}

export function targetFor(href: string): LinkTarget {
  const page = BUILT_IN_PAGES.find((entry) => entry.path === href);
  if (page) return { kind: "page", page: page.key };
  const [path, query = ""] = href.split("?", 2);
  if (path === LIBRARY_PATH) {
    const collectionId = new URLSearchParams(query).get(COLLECTIONS_PARAM);
    if (collectionId) return { kind: "collection", collectionId };
  }
  return { kind: "url", url: href };
}

export function newLink(id: string): LinkDraft {
  return {
    id,
    label: "",
    target: { kind: "page", page: "home" },
    icon: "",
    newTab: false,
    visible: true,
    children: [],
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Builds the page's link from a saved runtime link. `fallbackId` is used when the row has no id. */
export function readLink(value: unknown, fallbackId = ""): LinkDraft {
  const link = record(value);
  const icon = NAV_ICONS.includes(link.icon as NavIcon) ? (link.icon as NavIcon) : "";
  return {
    id: typeof link.id === "string" && link.id ? link.id : fallbackId,
    label: typeof link.label === "string" ? link.label : "",
    target: targetFor(typeof link.href === "string" ? link.href : "/"),
    icon,
    newTab: link.target === "blank",
    visible: link.visible !== false,
    children: Array.isArray(link.children)
      ? link.children.map((child, index) => readLink(child, `${fallbackId}_${index}`))
      : [],
  };
}

/** The runtime shape of one link. Dropdown links are written only where the runtime allows them. */
export function linkPayload(
  link: LinkDraft,
  options: { children: boolean },
): Record<string, unknown> {
  const external = link.target.kind === "url";
  return {
    id: link.id,
    label: link.label,
    href: hrefFor(link.target),
    ...(link.icon ? { icon: link.icon } : {}),
    target: external && link.newTab ? "blank" : "self",
    visible: link.visible,
    ...(options.children
      ? { children: link.children.map((child) => linkPayload(child, { children: false })) }
      : {}),
  };
}

export type LinkProblem = "linkLabel" | "linkUrl" | "linkCollection";

/** What is wrong with one link, ignoring its children. */
export function linkProblems(link: LinkDraft): LinkProblem[] {
  const problems: LinkProblem[] = [];
  if (!link.label.trim()) problems.push("linkLabel");
  if (link.target.kind === "url" && !HTTPS_URL.test(link.target.url)) problems.push("linkUrl");
  if (link.target.kind === "collection" && !link.target.collectionId) {
    problems.push("linkCollection");
  }
  return problems;
}
