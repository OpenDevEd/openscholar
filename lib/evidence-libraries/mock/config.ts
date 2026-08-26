/**
 * Full library configuration for the design prototype.
 * Shapes follow the runtime schema where one exists; everything else
 * (domain, team, versions, share image, legal files) is OpenScholar-side.
 */

export type MockFile = {
  name: string;
  /** Bytes. */
  size: number;
  /** Object URL or data URL for the thumbnail / view dialog. */
  url: string;
  /** Text content for Markdown / text files. */
  text?: string;
};

export type LegalSource =
  | { kind: "none" }
  | { kind: "file"; file: MockFile }
  | { kind: "url"; url: string };

export const FONT_FAMILIES = ["Montserrat", "Poppins", "Ubuntu"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const NAV_ICONS = [
  "AboutUs",
  "EvidenceLibrary",
  "Programs",
  "Blog",
  "Team",
  "ContactUs",
  "TeamFill",
  "ToolsFill",
  "BookOpenFill",
  "Bookshelf",
  "ChatRightDotsFill",
  "BsMapFill",
  "LuX",
  "FaQuestionCircle",
  "IoStatsChart",
] as const;
export type NavIcon = (typeof NAV_ICONS)[number];

export const BUILT_IN_PAGES = [
  { key: "home", path: "/" },
  { key: "library", path: "/lib" },
  { key: "map", path: "/map" },
  { key: "contact", path: "/contact" },
  { key: "privacy", path: "/privacy" },
  { key: "cookiePolicy", path: "/cookie-policy" },
  { key: "takedown", path: "/takedown" },
] as const;
export type BuiltInPageKey = (typeof BUILT_IN_PAGES)[number]["key"];

export type NavTarget =
  | { kind: "page"; page: BuiltInPageKey }
  | { kind: "collection"; collectionId: string }
  | { kind: "url"; url: string };

export type NavLink = {
  id: string;
  label: string;
  target: NavTarget;
  icon: NavIcon | "";
  newTab: boolean;
  visible: boolean;
  children: NavLink[];
};

export const SOCIAL_PROVIDERS = [
  "github",
  "twitter",
  "linkedin",
  "youtube",
  "bluesky",
] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export type FooterSection = { id: string; title: string; links: NavLink[] };
export type Funder = { id: string; name: string; logo: MockFile | null; url: string };
export type Institution = { id: string; name: string; logo: MockFile | null };
export type FundingPartner = { id: string; name: string };

export const SEARCH_SCOPES = [
  "title_abstract_author_and_keywords",
  "title_abstract_and_keywords",
  "title_and_abstract",
  "title",
  "authors",
  "fields",
  "documents",
  "everywhere",
] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

export type InstitutionFacetMode = "hidden" | "facet" | "facet-with-featured-value";

/** Providers an owner may bring their own key for. Matches OpenScholar's provider configs. */
export const AI_KEY_PROVIDERS = ["openai", "google", "anthropic", "deepseek"] as const;
export type AiKeyProvider = (typeof AI_KEY_PROVIDERS)[number];

/** How AI answers are paid for. Exactly one path per library. */
export type AiBilling = "credits" | "openrouter" | "providers";

export type AiSettings = {
  billing: AiBilling;
  openRouterKey: string;
  providerKeys: Partial<Record<AiKeyProvider, string>>;
  /** OpenRouter model ids from OpenScholar's catalog that visitors can choose. */
  models: string[];
  defaultModel: string;
};

export const FEATURE_KEYS = [
  "themeSwitcher",
  "languageSwitcher",
  "login",
  "googleSignIn",
  "userCollections",
  "ai",
  "aiSearch",
  "deepResearch",
  "relatedResources",
  "collections",
  "collectionNotes",
  "mapPage",
  "authorFilter",
  "authorLocation",
  "yearsDropdown",
  "downloads",
  "atomFeed",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_GROUPS: { key: string; features: FeatureKey[] }[] = [
  { key: "appearance", features: ["themeSwitcher", "languageSwitcher"] },
  { key: "accounts", features: ["login", "googleSignIn", "userCollections"] },
  {
    key: "discovery",
    features: [
      "collections",
      "collectionNotes",
      "mapPage",
      "authorFilter",
      "authorLocation",
      "yearsDropdown",
    ],
  },
  { key: "exports", features: ["downloads", "atomFeed"] },
];

export type GroupHealth = "healthy" | "paused" | "error" | "new";

/** A Zotero group the library imports from. Name and counts come from Zotero. */
export type ZoteroGroupSource = {
  id: string;
  groupId: string;
  name: string;
  isPublic: boolean;
  /** Records in the library database from this group. */
  items: number;
  writeback: boolean;
  paused: boolean;
  lastSync: string | null;
  lastError: string | null;
};

/** One Zotero connection per library. */
export type ZoteroAccount =
  | { method: "none" }
  | { method: "zotero"; handle: string }
  | { method: "apiKey"; apiKey: string };

/** Groups visible to the connected account (mock). */
export type ZoteroGroupOption = { groupId: string; name: string; isPublic: boolean; items: number; members: number };

export const TAG_RULE_KEYS = [
  "hidden",
  "internal",
  "comingSoon",
  "description",
  "redirects",
  "publish",
] as const;
export type TagRuleKey = (typeof TAG_RULE_KEYS)[number];

/** A collection that exists in the library's database, from any source. */
export type DatabaseCollection = {
  id: string;
  title: string;
  count: number;
  /** Where it came from, e.g. the Zotero group name. */
  source: string;
};

/** A database collection the owner chose to show on the site. */
export type CollectionSetting = {
  id: string;
  /** Title in the database, read-only. */
  sourceTitle: string;
  title: string;
  enabled: boolean;
  /** Records in this collection, read-only. */
  count: number;
};

export type Visibility = "public" | "members";
export type AccessRole = "editor" | "viewer";
export type AccessGrant = {
  id: string;
  subject:
    | { kind: "person"; email: string; name: string }
    | { kind: "organization"; orgId: string; name: string; members: number };
  role: AccessRole;
  status: "active" | "invited";
};

export type DnsStatus = "none" | "pending" | "checking" | "verified" | "failed";

export type LibraryVersion = {
  rev: string;
  at: string;
  by: string;
  sections: string[];
  status: "live" | "previous" | "failed";
  /** "runtime" when the version only updated the Evidence Library software. */
  kind?: "config" | "runtime";
};

/** Which build of the Evidence Library runtime a library runs, and what is on new-el main. */
export type RuntimeState = {
  running: string;
  latest: string;
  /** Commit messages between running and latest, newest first. */
  changes: string[];
  checkedAt: string;
};

export type LibraryConfig = {
  identity: {
    name: string;
    shortName: string;
    tagline: string;
    description: string;
    fundingPartners: FundingPartner[];
    shareImage: MockFile | null;
  };
  theme: {
    layout: "small" | "wide";
    defaultMode: "light" | "dark" | "system";
    headingFont: FontFamily;
    bodyFont: FontFamily;
    logoDark: MockFile | null;
    logoLight: MockFile | null;
    favicon: MockFile | null;
    accent: string;
    secondary: string;
    link: string;
    backgroundDark: string;
    backgroundLight: string;
    cardDark: string;
    cardLight: string;
  };
  institutions: Institution[];
  navigation: { links: NavLink[]; showSearch: boolean };
  footer: {
    sections: FooterSection[];
    social: Partial<Record<SocialProvider, string>>;
    funders: Funder[];
    disclaimer: string;
    attribution: string;
    poweredBy: boolean;
  };
  contact: {
    email: string;
    phone: string;
    address: string;
    contactRecipient: string;
    takedownRecipient: string;
    privacy: LegalSource;
    cookie: LegalSource;
    terms: LegalSource;
  };
  collections: CollectionSetting[];
  search: {
    fullText: boolean;
    tags: boolean;
    country: boolean;
    authorCountry: boolean;
    scopes: SearchScope[];
    defaultScope: SearchScope;
    institutionMode: InstitutionFacetMode;
    institutionLabel: string;
    featuredInstitution: string;
    yearsEnabled: boolean;
    yearMin: number;
    yearMax: number;
    collectionsExpanded: boolean;
  };
  citations: { showUrl: boolean; ris: boolean; bibtex: boolean; atom: boolean };
  features: Record<FeatureKey, boolean> & { aiSettings: AiSettings };
  sources: {
    account: ZoteroAccount;
    groups: ZoteroGroupSource[];
    tagRules: Record<TagRuleKey, string[]>;
  };
  localization: {
    locales: string[];
    defaultLocale: string;
    detect: boolean;
    priority: string[];
  };
  analytics:
    | { provider: "none" }
    | { provider: "posthog"; host: string; key: string }
    | { provider: "google"; measurementId: string };
  team: { visibility: Visibility; grants: AccessGrant[] };
  domain: {
    custom: string;
    status: DnsStatus;
    redirectPlatform: boolean;
  };
};

export type SectionKey =
  | "identity"
  | "theme"
  | "institutions"
  | "navigation"
  | "footer"
  | "contact"
  | "collections"
  | "search"
  | "citations"
  | "features"
  | "ai"
  | "sources"
  | "languages"
  | "analytics"
  | "team"
  | "domain"
  | "versions"
  | "danger";

export const RAIL_GROUPS: { key: string; sections: SectionKey[] }[] = [
  { key: "brand", sections: ["identity", "theme", "institutions"] },
  { key: "content", sections: ["navigation", "footer", "contact", "collections"] },
  { key: "discovery", sections: ["search", "citations", "features", "ai", "sources"] },
  { key: "platform", sections: ["languages", "analytics", "team"] },
  { key: "publishing", sections: ["domain", "versions"] },
  { key: "danger", sections: ["danger"] },
];

/** Sections that live in the draft and take part in Save / Activate. */
export const DRAFT_SECTIONS: Exclude<SectionKey, "versions" | "danger">[] = [
  "identity",
  "theme",
  "institutions",
  "navigation",
  "footer",
  "contact",
  "collections",
  "search",
  "citations",
  "features",
  "ai",
  "sources",
  "languages",
  "analytics",
  "team",
  "domain",
];

export const CURRENT_YEAR = 2026;

export const newId = (prefix: string) =>
  prefix + "_" + Math.random().toString(36).slice(2, 8);

export const HEX = /^#[0-9a-f]{6}$/i;

export const COLOUR_PRESETS: { name: string; accent: string; secondary: string; link: string }[] = [
  { name: "Sunrise", accent: "#e68124", secondary: "#2b4c7e", link: "#c2410c" },
  { name: "Forest", accent: "#1d9a6c", secondary: "#0f3d3e", link: "#047857" },
  { name: "Ocean", accent: "#2563eb", secondary: "#1e293b", link: "#1d4ed8" },
  { name: "Violet", accent: "#7c3aed", secondary: "#3b0764", link: "#6d28d9" },
  { name: "Rose", accent: "#e11d48", secondary: "#4c0519", link: "#be123c" },
  { name: "Slate", accent: "#475569", secondary: "#0f172a", link: "#334155" },
  { name: "Amber", accent: "#d97706", secondary: "#292524", link: "#b45309" },
  { name: "Teal", accent: "#0d9488", secondary: "#134e4a", link: "#0f766e" },
];

/** Relative luminance for WCAG contrast. */
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrastRatio(a: string, b: string) {
  if (!HEX.test(a) || !HEX.test(b)) return 0;
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Feature dependencies: a feature can be on only when all listed are on. */
export const FEATURE_DEPENDENCIES: Partial<Record<FeatureKey, FeatureKey[]>> = {
  googleSignIn: ["login"],
  userCollections: ["login"],
  aiSearch: ["ai"],
  deepResearch: ["ai", "aiSearch"],
  relatedResources: ["ai"],
  collectionNotes: ["collections"],
  authorLocation: ["authorFilter"],
};

export const FILE_LIMITS = {
  image: { accept: ["image/svg+xml", "image/png", "image/webp"], maxBytes: 1_000_000 },
  shareImage: { accept: ["image/png"], maxBytes: 2_000_000 },
  legal: { accept: ["text/markdown", "text/plain", ".md", ".txt"], maxBytes: 200_000 },
} as const;
export type FileKind = keyof typeof FILE_LIMITS;

export const formatBytes = (bytes: number) =>
  bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : bytes >= 1000
      ? `${Math.round(bytes / 1000)} KB`
      : `${bytes} B`;
