/**
 * Draft model and rules for the configuration page.
 *
 * The page keeps one draft object built from the saved section rows. The
 * rules here decide which sections changed, which have problems, and what
 * gets sent to `saveDraftSections`. Limits, choices and defaults come from
 * the pinned runtime schema so nothing is written by hand twice.
 *
 * Two lists matter: the cards the page shows (`PAGE_SECTION_KEYS`) and the
 * runtime rows they write (`ROW_KEYS`). A card can write more than one row
 * (Contact & legal writes `contact`, `email` and `legal`) and a row can be
 * shared by cards (the Navigation card owns `features.navbarSearch`).
 */

import schema from "./generated/library-config.schema.json";
import {
  HTTPS_URL,
  type LinkDraft,
  type LinkProblem,
  linkPayload,
  linkProblems,
  readLink,
} from "./links";
import { resolveSchemaPointer } from "./section-registry";
import type { ZoteroSourceEntry } from "@/convex/zotero/sourceEntry";
import {
  TAG_RULE_KEYS,
  type TagRuleKey,
  type TagRules,
  tagRuleIssue,
} from "@/components/evidence-libraries/configuration/sections/tag-rules";

export type SectionRow = { sectionKey: string; payload: unknown };

/** Cards this version of the page shows, in rail order. */
export const PAGE_SECTION_KEYS = [
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
  "sources",
  "languages",
  "analytics",
] as const;
export type PageSectionKey = (typeof PAGE_SECTION_KEYS)[number];

/** Runtime rows the page writes. */
const ROW_KEYS = [
  "identity",
  "theme",
  "institutions",
  "navigation",
  "features",
  "footer",
  "contact",
  "email",
  "legal",
  "collections",
  "search",
  "filters",
  "sources",
  "content",
  "citations",
  "exports",
  "localization",
  "analytics",
] as const;
type RowKey = (typeof ROW_KEYS)[number];

export type SectionState = "complete" | "edited" | "attention";

type SectionProblem =
  | "nameMissing"
  | "partnerName"
  | "logoMissing"
  | "faviconMissing"
  | "badColour"
  | "institutionName"
  | LinkProblem
  | "footerTitle"
  | "socialUrl"
  | "funderName"
  | "funderUrl"
  | "takedownRecipient"
  | "contactRecipient"
  | "contactEmail"
  | "phone"
  | "legalUrl"
  | "searchScopes"
  | "defaultScope"
  | "featuredInstitution"
  | "years"
  | "tagRules"
  | "featureDependency"
  | "languages"
  | "posthog"
  | "google"
  | "exportUrl"
  | "legalText";

/* ------------------------------------------------------------------ */
/* Schema facts                                                        */
/* ------------------------------------------------------------------ */

function schemaNode(pointer: string): Record<string, unknown> {
  const node = resolveSchemaPointer(schema, pointer);
  if (!node || typeof node !== "object") {
    throw new Error(`Configuration schema is missing ${pointer}`);
  }
  return node as Record<string, unknown>;
}

function schemaNumber(pointer: string, key: "maxLength" | "maxItems"): number {
  const value = schemaNode(pointer)[key];
  if (typeof value !== "number") {
    throw new Error(`Configuration schema has no ${key} at ${pointer}`);
  }
  return value;
}

function schemaDefault(pointer: string): string {
  const value = schemaNode(pointer).default;
  if (typeof value !== "string") {
    throw new Error(`Configuration schema has no default at ${pointer}`);
  }
  return value;
}

function schemaPattern(pointer: string): RegExp {
  const value = schemaNode(pointer).pattern;
  if (typeof value !== "string") {
    throw new Error(`Configuration schema has no pattern at ${pointer}`);
  }
  return new RegExp(value);
}

function schemaEnum<T extends string>(pointer: string): readonly T[] {
  const values = schemaNode(pointer).enum;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Configuration schema has no choices at ${pointer}`);
  }
  return values as T[];
}

export const SCHEMA_LIMITS = {
  identity: {
    name: schemaNumber("/identity/name", "maxLength"),
    tagline: schemaNumber("/identity/tagline", "maxLength"),
    description: schemaNumber("/identity/description", "maxLength"),
    fundingPartners: schemaNumber("/identity/fundingPartners", "maxItems"),
    partnerName: schemaNumber("/identity/fundingPartners/*/name", "maxLength"),
  },
  institutions: {
    items: schemaNumber("/institutions", "maxItems"),
    name: schemaNumber("/institutions/*/name", "maxLength"),
  },
  navigation: {
    links: schemaNumber("/navigation/links", "maxItems"),
    children: schemaNumber("/navigation/links/*/children", "maxItems"),
    label: schemaNumber("/navigation/links/*/label", "maxLength"),
  },
  footer: {
    sections: schemaNumber("/footer/sections", "maxItems"),
    sectionTitle: schemaNumber("/footer/sections/*/title", "maxLength"),
    sectionLinks: schemaNumber("/footer/sections/*/links", "maxItems"),
    funders: schemaNumber("/footer/funders", "maxItems"),
    funderName: schemaNumber("/footer/funders/*/name", "maxLength"),
    disclaimer: schemaNumber("/footer/disclaimer", "maxLength"),
    attribution: schemaNumber("/footer/attribution", "maxLength"),
  },
  contact: {
    address: schemaNumber("/contact/address", "maxLength"),
  },
  filters: {
    institutionLabel: schemaNumber("/filters/institution/label", "maxLength"),
    yearMinimum: (() => {
      const value = schemaNode("/filters/years/minimum").minimum;
      if (typeof value !== "number") throw new Error("Configuration schema has no minimum year");
      return value;
    })(),
  },
} as const;

export const LOCALES = schemaEnum<"en-GB" | "en-US" | "de" | "ar" | "hi" | "fr" | "cn" | "sw" | "pt">(
  "/localization/locales/*",
);
export type Locale = (typeof LOCALES)[number];
export const EXPORT_FORMATS = ["ris", "bibtex", "atom"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
const EXPORT_URL_MAX_LENGTH = schemaNumber("/exports/ris", "maxLength");
/**
 * An export address the runtime accepts. The runtime fetches this outside file
 * and streams it on `/lib/export/<format>` or `/lib/atom.xml` (new-el
 * `src/app/api/exports/[format]/route.ts`), so it must not point back at the
 * library's own address or the request loops onto itself.
 */
export const isExportUrl = (url: string, baseUrl: string) => {
  if (!HTTPS_URL.test(url) || url.length > EXPORT_URL_MAX_LENGTH) return false;
  const origin = baseUrl.replace(/\/+$/, "").toLowerCase();
  return origin === "" || !url.toLowerCase().startsWith(`${origin}/`);
};
const POSTHOG_KEY_PATTERN = schemaPattern("/analytics/posthog/key");
const POSTHOG_KEY_MIN_LENGTH = (() => {
  const value = schemaNode("/analytics/posthog/key").minLength;
  if (typeof value !== "number") throw new Error("Configuration schema has no PostHog key length");
  return value;
})();
/** A PostHog project key the runtime accepts: `phc_` prefix and the schema's minimum length. */
export const isPosthogKey = (key: string) =>
  POSTHOG_KEY_PATTERN.test(key) && key.length >= POSTHOG_KEY_MIN_LENGTH;
export const MEASUREMENT_ID = schemaPattern("/analytics/google/measurementId");
export const ANALYTICS_PROVIDERS = ["none", "posthog", "google"] as const;
type AnalyticsProvider = (typeof ANALYTICS_PROVIDERS)[number];

export const SEARCH_SCOPES = schemaEnum<
  | "title_abstract_author_and_keywords"
  | "title_abstract_and_keywords"
  | "title_and_abstract"
  | "title"
  | "authors"
  | "fields"
  | "documents"
  | "everywhere"
>("/search/scopes/*");
export type SearchScope = (typeof SEARCH_SCOPES)[number];
export const INSTITUTION_MODES = schemaEnum<"hidden" | "facet" | "facet-with-featured-value">(
  "/filters/institution/mode",
);
export type InstitutionMode = (typeof INSTITUTION_MODES)[number];
/** The runtime's default scope list: every scope, minus full text when full-text search is off. */
const defaultScopes = (fullText: boolean): SearchScope[] =>
  SEARCH_SCOPES.filter((scope) => fullText || scope !== "documents");
export const currentYear = () => new Date().getUTCFullYear();

/** An email address the runtime accepts. */
export const EMAIL = schemaPattern("/contact/email");
/** A phone number in international format, as the runtime requires. */
export const PHONE = schemaPattern("/contact/phone");

export const THEME_LAYOUTS = schemaEnum<"small" | "wide">("/theme/layout");
type ThemeLayout = (typeof THEME_LAYOUTS)[number];

export const THEME_MODES = schemaEnum<"light" | "dark" | "system">(
  "/theme/defaultMode",
);
type ThemeMode = (typeof THEME_MODES)[number];

export const FONT_FAMILIES = schemaEnum<string>("/theme/fonts/heading/family");
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const SOCIAL_PROVIDERS = schemaEnum<
  "github" | "twitter" | "linkedin" | "youtube" | "bluesky"
>("/footer/socialLinks/*/provider");
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

const COLOUR_KEYS = [
  "accent",
  "tertiary",
  "link",
  "backgroundDark",
  "backgroundLight",
  "cardDark",
  "cardLight",
] as const;
export type ColourKey = (typeof COLOUR_KEYS)[number];

const colourPattern = schemaNode("/theme/colors/accent").pattern;
if (typeof colourPattern !== "string") {
  throw new Error("Configuration schema has no colour pattern");
}
/** A colour the runtime accepts: #rrggbb or #rrggbbaa. */
export const HEX_COLOUR = new RegExp(colourPattern);

export const THEME_DEFAULTS = {
  layout: schemaDefault("/theme/layout") as ThemeLayout,
  defaultMode: schemaDefault("/theme/defaultMode") as ThemeMode,
  colors: {
    accent: "#e68124",
    tertiary: "#2b4c7e",
    link: "#c2410c",
    backgroundDark: schemaDefault("/theme/colors/backgroundDark"),
    backgroundLight: schemaDefault("/theme/colors/backgroundLight"),
    cardDark: schemaDefault("/theme/colors/cardDark"),
    cardLight: schemaDefault("/theme/colors/cardLight"),
  } satisfies Record<ColourKey, string>,
  fonts: { heading: "Montserrat", body: "Ubuntu" },
} as const;

/** Every runtime feature switch with its schema default. */
export type FeatureKey = keyof typeof schema.properties.features.properties;
const FEATURE_DEFAULTS = Object.fromEntries(
  Object.entries(schema.properties.features.properties).map(([key, node]) => [
    key,
    (node as { default?: boolean }).default === true,
  ]),
) as Record<FeatureKey, boolean>;
export const FEATURE_KEYS = Object.keys(FEATURE_DEFAULTS) as FeatureKey[];

/* ------------------------------------------------------------------ */
/* Draft shape                                                         */
/* ------------------------------------------------------------------ */

type FundingPartner = { id: string; name: string };

type IdentityDraft = {
  name: string;
  shortName: string;
  baseUrl: string;
  tagline: string;
  description: string;
  fundingPartners: FundingPartner[];
  assets: {
    logoDark: string;
    logoLight: string;
    favicon: string;
    shareImage: string;
  };
};

export type ThemeDraft = {
  layout: ThemeLayout;
  defaultMode: ThemeMode;
  colors: Record<ColourKey, string>;
  fonts: { heading: FontFamily; body: FontFamily };
};

type InstitutionDraft = { id: string; name: string; logoUrl: string };

export type FooterSectionDraft = { id: string; title: string; links: LinkDraft[] };
export type FunderDraft = { id: string; name: string; logoUrl: string; href: string };
export type FooterDraft = {
  sections: FooterSectionDraft[];
  social: Partial<Record<SocialProvider, string>>;
  funders: FunderDraft[];
  disclaimer: string;
  attribution: string;
  poweredBy: boolean;
};

export type ContactDraft = { email: string; phone: string; address: string };
export type EmailDraft = { contactRecipient: string; takedownRecipient: string };

/**
 * Where a legal page comes from: nothing, uploaded text, or an address
 * elsewhere. Text may be empty while the owner has chosen to upload a file
 * but has not done so yet; nothing is written until the text arrives.
 */
export type LegalSource =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "url"; url: string };
export const LEGAL_KEYS = ["privacy", "cookie", "terms"] as const;
export type LegalKey = (typeof LEGAL_KEYS)[number];
export type LegalDraft = Record<LegalKey, LegalSource>;

export type SearchDraft = {
  fullText: boolean;
  tags: boolean;
  country: boolean;
  authorCountry: boolean;
  scopes: SearchScope[];
  defaultScope: SearchScope;
};
export type FiltersDraft = {
  institution: { mode: InstitutionMode; label: string; featuredValue: string };
  collectionsExpanded: boolean;
  /** A cleared year box is undefined until the owner types a year again. */
  years: { enabled: boolean; minimum: number | undefined; maximum: number | undefined };
};
type CollectionDraft = { id: string; title?: string; enabled?: boolean; order?: number };

type LocalizationDraft = {
  locales: Locale[];
  defaultLocale: Locale;
  detectLocale: boolean;
  localePriority: Locale[];
};
type AnalyticsDraft = {
  provider: AnalyticsProvider;
  posthog: { host: string; key: string };
  google: { measurementId: string };
};

export type ConfigurationDraft = {
  identity: IdentityDraft;
  theme: ThemeDraft;
  institutions: InstitutionDraft[];
  navigation: { links: LinkDraft[] };
  features: Record<FeatureKey, boolean>;
  footer: FooterDraft;
  contact: ContactDraft;
  email: EmailDraft;
  legal: LegalDraft;
  collections: CollectionDraft[];
  search: SearchDraft;
  filters: FiltersDraft;
  sources: ZoteroSourceEntry[];
  /** `content.tags`: which Zotero tags mean hidden, coming soon, and so on. Edited on the Sources card. */
  content: { tags: TagRules };
  citations: { showUrl: boolean };
  /** `exports.<format>`: the address of an outside RIS, BibTeX or Atom file the runtime streams. Empty means off. */
  exports: Record<ExportFormat, string>;
  localization: LocalizationDraft;
  analytics: AnalyticsDraft;
};

/** Feature switches the page shows, in their groups. Accounts and AI come later. */
export const FEATURE_GROUPS = [
  { key: "appearance", features: ["themeSwitcher", "languageSwitcher"] },
  {
    key: "discovery",
    features: ["collections", "collectionNotes", "countryFocus", "authorFilter", "authorLocation", "yearsDropdown"],
  },
  { key: "exports", features: ["downloads", "atomFeed"] },
] as const satisfies readonly { key: string; features: readonly FeatureKey[] }[];
export type ShownFeature = (typeof FEATURE_GROUPS)[number]["features"][number];

/**
 * Why a feature cannot be on right now, or null. Each rule is one the runtime
 * enforces at load time in new-el `src/config/library-config/schema.ts`
 * lines 1569-1750 (main, 7c269e10); the pinned JSON schema does not carry cross-field rules
 * (`catalogs.validation.crossFieldRulesInJsonSchema` is false).
 */
export type FeatureBlock =
  | { kind: "feature"; feature: ShownFeature }
  | { kind: "search"; option: "country" | "authorCountry" }
  | { kind: "years" }
  | { kind: "exports" }
  | { kind: "atom" }
  | { kind: "languages" };

export function featureBlock(draft: ConfigurationDraft, feature: ShownFeature): FeatureBlock | null {
  switch (feature) {
    case "collectionNotes":
      // schema.ts:1702 "Collection notes require collections"
      return draft.features.collections ? null : { kind: "feature", feature: "collections" };
    case "countryFocus":
      // schema.ts:1710 "Country focus requires country search"
      return draft.search.country ? null : { kind: "search", option: "country" };
    case "authorLocation":
      // schema.ts:1718 "Author location requires author-country search"
      return draft.search.authorCountry ? null : { kind: "search", option: "authorCountry" };
    case "yearsDropdown":
      // schema.ts:1726 "Years dropdown requires the years filter"
      return draft.filters.years.enabled ? null : { kind: "years" };
    case "downloads":
      // schema.ts:1738 "Downloads require a RIS or BibTeX endpoint"
      return hasExport(draft, "ris") || hasExport(draft, "bibtex") ? null : { kind: "exports" };
    case "atomFeed":
      // schema.ts:1746 "Atom feed requires an Atom endpoint"
      return hasExport(draft, "atom") ? null : { kind: "atom" };
    case "languageSwitcher":
      // schema.ts:1595 "Language switcher requires at least two enabled locales"
      return draft.localization.locales.length >= 2 ? null : { kind: "languages" };
    default:
      return null;
  }
}

const hasExport = (draft: ConfigurationDraft, format: ExportFormat) =>
  isExportUrl(draft.exports[format], draft.identity.baseUrl);

const SHOWN_FEATURES = FEATURE_GROUPS.flatMap((group) => group.features) as ShownFeature[];

/** Turns off every shown feature whose requirement no longer holds. Call after a change that can break one. */
export function settleFeatures(draft: ConfigurationDraft): ConfigurationDraft {
  for (const feature of SHOWN_FEATURES) {
    if (draft.features[feature] && featureBlock(draft, feature)) draft.features[feature] = false;
  }
  return draft;
}

/** Collections as link targets: the shown title, or the id when none was set. */
export const collectionOptions = (draft: ConfigurationDraft) =>
  draft.collections.map((collection) => ({ id: collection.id, title: collection.title || collection.id }));

export const newId = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------------ */
/* Reading saved rows                                                  */
/* ------------------------------------------------------------------ */

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function choice<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function payloadOf(rows: readonly SectionRow[], sectionKey: string) {
  return rows.find((row) => row.sectionKey === sectionKey)?.payload;
}

function readIdentity(payload: unknown): IdentityDraft {
  const identity = record(payload);
  const assets = record(identity.assets);
  const partners = list(identity.fundingPartners).map((partner) => {
    const row = record(partner);
    return { id: text(row.id) || newId("fp"), name: text(row.name) };
  });
  return {
    name: text(identity.name),
    shortName: text(identity.shortName),
    baseUrl: text(identity.baseUrl),
    tagline: text(identity.tagline),
    description: text(identity.description),
    fundingPartners: partners,
    assets: {
      logoDark: text(assets.logoDark),
      logoLight: text(assets.logoLight),
      favicon: text(assets.favicon),
      shareImage: text(assets.shareImage),
    },
  };
}

function readFont(value: unknown, fallback: FontFamily): FontFamily {
  const font = record(value);
  return choice(font.family, FONT_FAMILIES, fallback);
}

function readTheme(payload: unknown): ThemeDraft {
  const theme = record(payload);
  const colors = record(theme.colors);
  const fonts = record(theme.fonts);
  return {
    layout: choice(theme.layout, THEME_LAYOUTS, THEME_DEFAULTS.layout),
    defaultMode: choice(
      theme.defaultMode,
      THEME_MODES,
      THEME_DEFAULTS.defaultMode,
    ),
    colors: Object.fromEntries(
      COLOUR_KEYS.map((key) => [key, text(colors[key], THEME_DEFAULTS.colors[key])]),
    ) as Record<ColourKey, string>,
    fonts: {
      heading: readFont(fonts.heading, THEME_DEFAULTS.fonts.heading),
      body: readFont(fonts.body, THEME_DEFAULTS.fonts.body),
    },
  };
}

function readInstitutions(payload: unknown): InstitutionDraft[] {
  return list(payload).map((item) => {
    const row = record(item);
    return {
      id: text(row.id) || newId("inst"),
      name: text(row.name),
      logoUrl: text(row.logoUrl),
    };
  });
}

function readLinks(value: unknown, prefix: string): LinkDraft[] {
  return list(value).map((link) => readLink(link, newId(prefix)));
}

function readFeatures(payload: unknown): Record<FeatureKey, boolean> {
  const features = record(payload);
  return Object.fromEntries(
    FEATURE_KEYS.map((key) => [
      key,
      typeof features[key] === "boolean" ? features[key] : FEATURE_DEFAULTS[key],
    ]),
  ) as Record<FeatureKey, boolean>;
}

function readFooter(payload: unknown): FooterDraft {
  const footer = record(payload);
  const social: FooterDraft["social"] = {};
  for (const entry of list(footer.socialLinks)) {
    const row = record(entry);
    if (SOCIAL_PROVIDERS.includes(row.provider as SocialProvider)) {
      social[row.provider as SocialProvider] = text(row.href);
    }
  }
  return {
    sections: list(footer.sections).map((entry) => {
      const row = record(entry);
      return {
        id: text(row.id) || newId("fs"),
        title: text(row.title),
        links: readLinks(row.links, "fl"),
      };
    }),
    social,
    funders: list(footer.funders).map((entry) => {
      const row = record(entry);
      return {
        id: text(row.id) || newId("fu"),
        name: text(row.name),
        logoUrl: text(row.logoUrl),
        href: text(row.href),
      };
    }),
    disclaimer: text(footer.disclaimer),
    attribution: text(footer.attribution),
    // There is no plan model yet; the credit stays on (owner-rules.ts).
    poweredBy: true,
  };
}

function readContact(payload: unknown): ContactDraft {
  const contact = record(payload);
  return {
    email: text(contact.email),
    phone: text(contact.phone),
    address: text(contact.address),
  };
}

function readEmail(payload: unknown): EmailDraft {
  const email = record(payload);
  return {
    contactRecipient: text(email.contactRecipient),
    takedownRecipient: text(email.takedownRecipient),
  };
}

// Runtime field names per legal page: the link and the uploaded text.
const LEGAL_FIELDS: Record<LegalKey, { link: string; markdown: string }> = {
  privacy: { link: "privacyPolicy", markdown: "privacyMarkdown" },
  cookie: { link: "cookiePolicy", markdown: "cookieMarkdown" },
  terms: { link: "termsOfService", markdown: "termsMarkdown" },
};

function readLegal(payload: unknown): LegalDraft {
  const legal = record(payload);
  return Object.fromEntries(
    LEGAL_KEYS.map((key) => {
      const markdown = text(legal[LEGAL_FIELDS[key].markdown]);
      const link = text(legal[LEGAL_FIELDS[key].link]);
      const source: LegalSource = markdown
        ? { kind: "text", text: markdown }
        : HTTPS_URL.test(link)
          ? { kind: "url", url: link }
          : { kind: "none" };
      return [key, source];
    }),
  ) as LegalDraft;
}

function readCollections(payload: unknown): CollectionDraft[] {
  return list(payload).map((entry) => {
    const row = record(entry);
    return compact({
      id: text(row.id),
      title: optional(text(row.title)),
      enabled: typeof row.enabled === "boolean" ? row.enabled : undefined,
      order: typeof row.order === "number" ? row.order : undefined,
    });
  });
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readSearch(payload: unknown): SearchDraft {
  const search = record(payload);
  const fullText = flag(search.fullText, true);
  const scopes = Array.isArray(search.scopes)
    ? search.scopes.filter((scope): scope is SearchScope => SEARCH_SCOPES.includes(scope))
    : defaultScopes(fullText);
  return {
    fullText,
    tags: flag(search.tags, true),
    country: flag(search.country, true),
    authorCountry: flag(search.authorCountry, true),
    scopes,
    defaultScope: choice(search.defaultScope, SEARCH_SCOPES, scopes[0] ?? SEARCH_SCOPES[0]!),
  };
}

function readFilters(payload: unknown): FiltersDraft {
  const filters = record(payload);
  const institution = record(filters.institution);
  const years = record(filters.years);
  return {
    institution: {
      mode: choice(institution.mode, INSTITUTION_MODES, "facet"),
      label: text(institution.label, schemaDefault("/filters/institution/label")),
      featuredValue: text(institution.featuredValue),
    },
    collectionsExpanded: flag(filters.collectionsExpanded, true),
    years: {
      enabled: flag(years.enabled, true),
      minimum: typeof years.minimum === "number" ? years.minimum : SCHEMA_LIMITS.filters.yearMinimum,
      maximum: typeof years.maximum === "number" ? years.maximum : currentYear(),
    },
  };
}

function readSources(payload: unknown): ZoteroSourceEntry[] {
  return list(payload)
    .map((entry) => record(entry))
    .filter((row) => typeof row.groupId === "string" && row.groupId !== "")
    .map((row) => ({
      key: text(row.key) || `zotero-${text(row.groupId)}`,
      provider: "zotero" as const,
      groupId: text(row.groupId),
      enabled: flag(row.enabled, true),
      writebackEnabled: flag(row.writebackEnabled, false),
    }));
}

// Only the tag rules the runtime knows; anything else would fail the strict `content` row.
function readContent(payload: unknown): ConfigurationDraft["content"] {
  const tags = record(record(payload).tags);
  const known: TagRules = {};
  for (const key of TAG_RULE_KEYS) {
    const value = tags[key];
    if (Array.isArray(value)) known[key] = value.filter((tag): tag is string => typeof tag === "string");
  }
  return { tags: known };
}

/** Builds the page draft from the saved rows. Missing rows get defaults. */
export function readDraft(rows: readonly SectionRow[]): ConfigurationDraft {
  return {
    identity: readIdentity(payloadOf(rows, "identity")),
    theme: readTheme(payloadOf(rows, "theme")),
    institutions: readInstitutions(payloadOf(rows, "institutions")),
    navigation: { links: readLinks(record(payloadOf(rows, "navigation")).links, "nav") },
    features: readFeatures(payloadOf(rows, "features")),
    footer: readFooter(payloadOf(rows, "footer")),
    contact: readContact(payloadOf(rows, "contact")),
    email: readEmail(payloadOf(rows, "email")),
    legal: readLegal(payloadOf(rows, "legal")),
    collections: readCollections(payloadOf(rows, "collections")),
    search: readSearch(payloadOf(rows, "search")),
    filters: readFilters(payloadOf(rows, "filters")),
    sources: readSources(payloadOf(rows, "sources")),
    content: readContent(payloadOf(rows, "content")),
    citations: { showUrl: flag(record(payloadOf(rows, "citations")).showUrl, false) },
    exports: readExports(payloadOf(rows, "exports")),
    localization: readLocalization(payloadOf(rows, "localization")),
    analytics: readAnalytics(payloadOf(rows, "analytics")),
  };
}

function readExports(payload: unknown): Record<ExportFormat, string> {
  const exports = record(payload);
  return Object.fromEntries(
    EXPORT_FORMATS.map((format) => [format, typeof exports[format] === "string" ? exports[format] : ""]),
  ) as Record<ExportFormat, string>;
}

function readLocales(value: unknown): Locale[] {
  return list(value).filter((locale): locale is Locale => LOCALES.includes(locale as Locale));
}

function readLocalization(payload: unknown): LocalizationDraft {
  const localization = record(payload);
  const locales = readLocales(localization.locales);
  const priority = readLocales(localization.localePriority).filter((locale) => locales.includes(locale));
  return {
    locales,
    defaultLocale: choice(localization.defaultLocale, LOCALES, locales[0] ?? LOCALES[0]!),
    detectLocale: flag(localization.detectLocale, false),
    localePriority: [...priority, ...locales.filter((locale) => !priority.includes(locale))],
  };
}

function readAnalytics(payload: unknown): AnalyticsDraft {
  const analytics = record(payload);
  const posthog = record(analytics.posthog);
  const google = record(analytics.google);
  const key = text(posthog.key);
  const measurementId = text(google.measurementId);
  return {
    provider: key ? "posthog" : measurementId ? "google" : "none",
    posthog: { host: text(posthog.host), key },
    google: { measurementId },
  };
}

export function cloneDraft(draft: ConfigurationDraft): ConfigurationDraft {
  return structuredClone(draft);
}

/* ------------------------------------------------------------------ */
/* Payloads sent to the platform                                       */
/* ------------------------------------------------------------------ */

function optional(value: string): string | undefined {
  return value.trim() === "" ? undefined : value;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function identityPayload(identity: IdentityDraft) {
  return compact({
    name: identity.name,
    shortName: identity.shortName,
    baseUrl: identity.baseUrl,
    tagline: optional(identity.tagline),
    description: optional(identity.description),
    fundingPartners:
      identity.fundingPartners.length > 0
        ? identity.fundingPartners.map((partner) => ({
            id: partner.id,
            name: partner.name,
          }))
        : undefined,
    assets: compact({
      logoDark: identity.assets.logoDark,
      logoLight: optional(identity.assets.logoLight),
      favicon: identity.assets.favicon,
      shareImage: optional(identity.assets.shareImage),
    }),
  });
}

function themePayload(theme: ThemeDraft) {
  return {
    layout: theme.layout,
    defaultMode: theme.defaultMode,
    colors: { ...theme.colors },
    fonts: {
      heading: { source: "google", family: theme.fonts.heading },
      body: { source: "google", family: theme.fonts.body },
    },
  };
}

function institutionsPayload(institutions: InstitutionDraft[]) {
  return institutions.map((institution) =>
    compact({
      id: institution.id,
      name: institution.name,
      logoUrl: optional(institution.logoUrl),
    }),
  );
}

function navigationPayload(navigation: ConfigurationDraft["navigation"]) {
  return { links: navigation.links.map((link) => linkPayload(link, { children: true })) };
}

function footerPayload(footer: FooterDraft) {
  return {
    sections: footer.sections.map((section) => ({
      id: section.id,
      title: section.title,
      links: section.links.map((link) => linkPayload(link, { children: false })),
    })),
    socialLinks: SOCIAL_PROVIDERS.filter((provider) => footer.social[provider]).map(
      (provider) => ({ provider, href: footer.social[provider] }),
    ),
    funders: footer.funders.map((funder) =>
      compact({
        id: funder.id,
        name: funder.name,
        logoUrl: optional(funder.logoUrl),
        href: optional(funder.href),
      }),
    ),
    disclaimer: footer.disclaimer,
    attribution: footer.attribution,
    poweredBy: true,
  };
}

function contactPayload(contact: ContactDraft) {
  return compact({
    email: optional(contact.email),
    phone: optional(contact.phone),
    address: optional(contact.address),
  });
}

function emailPayload(email: EmailDraft) {
  return compact({
    contactRecipient: optional(email.contactRecipient),
    takedownRecipient: optional(email.takedownRecipient),
  });
}

function legalPayload(legal: LegalDraft) {
  const payload: Record<string, string> = {};
  for (const key of LEGAL_KEYS) {
    const source = legal[key];
    if (source.kind === "text" && source.text) payload[LEGAL_FIELDS[key].markdown] = source.text;
    if (source.kind === "url") payload[LEGAL_FIELDS[key].link] = source.url;
  }
  return payload;
}

function rowPayload(draft: ConfigurationDraft, rowKey: RowKey): unknown {
  switch (rowKey) {
    case "identity":
      return identityPayload(draft.identity);
    case "theme":
      return themePayload(draft.theme);
    case "institutions":
      return institutionsPayload(draft.institutions);
    case "navigation":
      return navigationPayload(draft.navigation);
    case "features":
      return { ...draft.features };
    case "footer":
      return footerPayload(draft.footer);
    case "contact":
      return contactPayload(draft.contact);
    case "email":
      return emailPayload(draft.email);
    case "legal":
      return legalPayload(draft.legal);
    case "collections":
      return draft.collections.map((collection) => compact({ ...collection }));
    case "search":
      return { ...draft.search, scopes: [...draft.search.scopes] };
    case "filters":
      return {
        institution: compact({
          mode: draft.filters.institution.mode,
          label: draft.filters.institution.label,
          featuredValue:
            draft.filters.institution.mode === "facet-with-featured-value"
              ? optional(draft.filters.institution.featuredValue)
              : undefined,
        }),
        collectionsExpanded: draft.filters.collectionsExpanded,
        years: compact({ ...draft.filters.years }),
      };
    case "sources":
      return draft.sources.map((source) => ({ ...source }));
    case "content":
      return { tags: { ...draft.content.tags } };
    case "citations":
      return { showUrl: draft.citations.showUrl };
    case "exports":
      return Object.fromEntries(
        EXPORT_FORMATS.filter((format) => draft.exports[format] !== "").map((format) => [
          format,
          draft.exports[format],
        ]),
      );
    case "localization": {
      const { locales, defaultLocale, detectLocale, localePriority } = draft.localization;
      return { locales: [...locales], defaultLocale, detectLocale, localePriority: [...localePriority] };
    }
    case "analytics": {
      const { provider, posthog, google } = draft.analytics;
      return compact({
        posthog: provider === "posthog" ? { host: posthog.host, key: posthog.key } : undefined,
        google: provider === "google" ? { measurementId: google.measurementId } : undefined,
      });
    }
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function hasRow(rows: readonly SectionRow[], rowKey: RowKey) {
  return rows.some((row) => row.sectionKey === rowKey);
}

/** Rows to send on Save: every row whose payload differs from its saved row. */
export function changedSectionRows(
  draft: ConfigurationDraft,
  rows: readonly SectionRow[],
): { sectionKey: RowKey; payload: unknown }[] {
  const saved = readDraft(rows);
  return ROW_KEYS.filter(
    (rowKey) =>
      !hasRow(rows, rowKey) || !same(rowPayload(draft, rowKey), rowPayload(saved, rowKey)),
  ).map((rowKey) => ({ sectionKey: rowKey, payload: rowPayload(draft, rowKey) }));
}

export const isDirty = (draft: ConfigurationDraft, rows: readonly SectionRow[]) =>
  changedSectionRows(draft, rows).length > 0;

/** Every uploaded file a draft points at: logos, favicon, share image, institution and funder logos. */
function uploadUrls(draft: ConfigurationDraft): string[] {
  return [
    ...Object.values(draft.identity.assets),
    ...draft.institutions.map((institution) => institution.logoUrl),
    ...draft.footer.funders.map((funder) => funder.logoUrl),
  ].filter((url) => url !== "");
}

/**
 * Saved files the draft no longer uses. Delete them only after the draft is
 * saved: until then the saved rows, and a live library, still point at them.
 */
export function staleUploads(
  draft: ConfigurationDraft,
  rows: readonly SectionRow[],
): string[] {
  const kept = new Set(uploadUrls(draft));
  return [...new Set(uploadUrls(readDraft(rows)))].filter((url) => !kept.has(url));
}

/* ------------------------------------------------------------------ */
/* What each card shows                                                */
/* ------------------------------------------------------------------ */

// The logos live in `identity.assets` on the runtime but the owner edits
// them on the Theme card, so the card slices differ from the saved rows.
const LOGO_KEYS = ["logoDark", "logoLight", "favicon"] as const;

function cardSlice(draft: ConfigurationDraft, sectionKey: PageSectionKey) {
  switch (sectionKey) {
    case "identity": {
      const { assets, ...rest } = draft.identity;
      return { ...rest, shareImage: assets.shareImage };
    }
    case "theme":
      return {
        theme: draft.theme,
        logos: LOGO_KEYS.map((key) => draft.identity.assets[key]),
      };
    case "institutions":
      return draft.institutions;
    case "navigation":
      return { links: draft.navigation.links, navbarSearch: draft.features.navbarSearch };
    case "citations":
      return { citations: draft.citations, exports: draft.exports };
    case "features":
      return SHOWN_FEATURES.map((feature) => draft.features[feature]);
    case "languages":
      return draft.localization;
    case "analytics":
      return draft.analytics;
    case "footer":
      return draft.footer;
    case "contact":
      return { contact: draft.contact, email: draft.email, legal: draft.legal };
    case "collections":
      return draft.collections;
    case "search":
      return { search: draft.search, filters: draft.filters };
    case "sources":
      return { sources: draft.sources, tags: draft.content.tags };
  }
}

const ROWS_FOR_CARD: Record<PageSectionKey, readonly RowKey[]> = {
  identity: ["identity"],
  theme: ["theme", "identity"],
  institutions: ["institutions"],
  navigation: ["navigation", "features"],
  footer: ["footer"],
  contact: ["contact", "email", "legal"],
  collections: ["collections"],
  search: ["search", "filters"],
  sources: ["sources", "content"],
  citations: ["citations", "exports"],
  features: ["features"],
  languages: ["localization"],
  analytics: ["analytics"],
};

/** The card that edits a runtime row, or null when the page has none for it. */
export function cardForRow(rowKey: string): PageSectionKey | null {
  // Two cards write `features` (Navigation owns navbarSearch); issues go to the Features card.
  if (rowKey === "features") return "features";
  return (
    PAGE_SECTION_KEYS.find((card) =>
      (ROWS_FOR_CARD[card] as readonly string[]).includes(rowKey),
    ) ?? null
  );
}

export function sectionChanged(
  draft: ConfigurationDraft,
  rows: readonly SectionRow[],
  sectionKey: PageSectionKey,
): boolean {
  if (ROWS_FOR_CARD[sectionKey].some((key) => !hasRow(rows, key))) return true;
  return !same(cardSlice(draft, sectionKey), cardSlice(readDraft(rows), sectionKey));
}

function allLinkProblems(links: readonly LinkDraft[]): LinkProblem[] {
  return links.flatMap((link) => [...linkProblems(link), ...allLinkProblems(link.children)]);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function sectionProblems(
  draft: ConfigurationDraft,
  sectionKey: PageSectionKey,
): SectionProblem[] {
  const problems: SectionProblem[] = [];
  switch (sectionKey) {
    case "identity":
      if (!draft.identity.name.trim()) problems.push("nameMissing");
      if (draft.identity.fundingPartners.some((partner) => !partner.name.trim())) {
        problems.push("partnerName");
      }
      break;
    case "theme":
      if (!draft.identity.assets.logoDark) problems.push("logoMissing");
      if (!draft.identity.assets.favicon) problems.push("faviconMissing");
      if (COLOUR_KEYS.some((key) => !HEX_COLOUR.test(draft.theme.colors[key]))) {
        problems.push("badColour");
      }
      break;
    case "institutions":
      if (draft.institutions.some((institution) => !institution.name.trim())) {
        problems.push("institutionName");
      }
      break;
    case "navigation":
      problems.push(...allLinkProblems(draft.navigation.links));
      break;
    case "footer": {
      const footer = draft.footer;
      if (footer.sections.some((section) => !section.title.trim())) {
        problems.push("footerTitle");
      }
      problems.push(...allLinkProblems(footer.sections.flatMap((section) => section.links)));
      if (Object.values(footer.social).some((url) => url && !HTTPS_URL.test(url))) {
        problems.push("socialUrl");
      }
      if (footer.funders.some((funder) => !funder.name.trim())) problems.push("funderName");
      if (footer.funders.some((funder) => funder.href && !HTTPS_URL.test(funder.href))) {
        problems.push("funderUrl");
      }
      break;
    }
    case "contact": {
      const { contact, email, legal } = draft;
      if (!EMAIL.test(email.takedownRecipient)) problems.push("takedownRecipient");
      if (email.contactRecipient && !EMAIL.test(email.contactRecipient)) {
        problems.push("contactRecipient");
      }
      if (contact.email && !EMAIL.test(contact.email)) problems.push("contactEmail");
      if (contact.phone && !PHONE.test(contact.phone)) problems.push("phone");
      if (
        LEGAL_KEYS.some((key) => {
          const source = legal[key];
          return source.kind === "url" && !HTTPS_URL.test(source.url);
        })
      ) {
        problems.push("legalUrl");
      }
      if (LEGAL_KEYS.some((key) => legal[key].kind === "text" && !legal[key].text)) {
        problems.push("legalText");
      }
      break;
    }
    case "collections":
      break;
    case "search": {
      const { search, filters } = draft;
      if (search.scopes.length === 0) problems.push("searchScopes");
      else if (!search.scopes.includes(search.defaultScope)) problems.push("defaultScope");
      if (
        filters.institution.mode === "facet-with-featured-value" &&
        !filters.institution.featuredValue.trim()
      ) {
        problems.push("featuredInstitution");
      }
      const { minimum, maximum } = filters.years;
      if (
        filters.years.enabled &&
        (minimum === undefined ||
          maximum === undefined ||
          minimum > maximum ||
          minimum < SCHEMA_LIMITS.filters.yearMinimum ||
          maximum > currentYear() ||
          !Number.isInteger(minimum) ||
          !Number.isInteger(maximum))
      ) {
        problems.push("years");
      }
      break;
    }
    case "sources":
      if (
        (Object.entries(draft.content.tags) as [TagRuleKey, string[]][]).some(
          ([key, tags]) => tagRuleIssue(key, tags) !== null,
        )
      ) {
        problems.push("tagRules");
      }
      break;
    case "citations":
      if (EXPORT_FORMATS.some((format) => draft.exports[format] !== "" && !hasExport(draft, format))) {
        problems.push("exportUrl");
      }
      break;
    case "features":
      if (SHOWN_FEATURES.some((feature) => draft.features[feature] && featureBlock(draft, feature))) {
        problems.push("featureDependency");
      }
      break;
    case "languages": {
      const { locales, defaultLocale } = draft.localization;
      if (locales.length === 0 || !locales.includes(defaultLocale)) problems.push("languages");
      break;
    }
    case "analytics": {
      const { provider, posthog, google } = draft.analytics;
      if (provider === "posthog" && (!HTTPS_URL.test(posthog.host) || !isPosthogKey(posthog.key))) {
        problems.push("posthog");
      }
      if (provider === "google" && !MEASUREMENT_ID.test(google.measurementId)) problems.push("google");
      break;
    }
  }
  return unique(problems);
}

export function sectionState(
  draft: ConfigurationDraft,
  rows: readonly SectionRow[],
  sectionKey: PageSectionKey,
): SectionState {
  if (sectionProblems(draft, sectionKey).length > 0) return "attention";
  return sectionChanged(draft, rows, sectionKey) ? "edited" : "complete";
}

export const hasProblems = (draft: ConfigurationDraft) =>
  PAGE_SECTION_KEYS.some((key) => sectionProblems(draft, key).length > 0);

/** Copies one card's values back from the saved rows. */
export function resetSection(
  draft: ConfigurationDraft,
  rows: readonly SectionRow[],
  sectionKey: PageSectionKey,
): ConfigurationDraft {
  const next = cloneDraft(draft);
  const saved = readDraft(rows);
  switch (sectionKey) {
    case "identity":
      next.identity = {
        ...saved.identity,
        assets: { ...saved.identity.assets },
      };
      for (const key of LOGO_KEYS) {
        next.identity.assets[key] = draft.identity.assets[key];
      }
      break;
    case "theme":
      next.theme = saved.theme;
      for (const key of LOGO_KEYS) {
        next.identity.assets[key] = saved.identity.assets[key];
      }
      break;
    case "institutions":
      next.institutions = saved.institutions;
      break;
    case "navigation":
      next.navigation = saved.navigation;
      next.features.navbarSearch = saved.features.navbarSearch;
      break;
    case "footer":
      next.footer = saved.footer;
      break;
    case "contact":
      next.contact = saved.contact;
      next.email = saved.email;
      next.legal = saved.legal;
      break;
    case "collections":
      next.collections = saved.collections;
      break;
    case "search":
      next.search = saved.search;
      next.filters = saved.filters;
      break;
    case "sources":
      next.sources = saved.sources;
      next.content = saved.content;
      break;
    case "citations":
      next.citations = saved.citations;
      next.exports = saved.exports;
      break;
    case "features":
      for (const feature of SHOWN_FEATURES) next.features[feature] = saved.features[feature];
      break;
    case "languages":
      next.localization = saved.localization;
      break;
    case "analytics":
      next.analytics = saved.analytics;
      break;
  }
  // A reset can take away what a feature needs (an export, a second language, a search option).
  return settleFeatures(next);
}
