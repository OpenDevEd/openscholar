/**
 * Draft model and rules for the configuration page.
 *
 * The page keeps one draft object built from the saved section rows. The
 * rules here decide which sections changed, which have problems, and what
 * gets sent to `saveDraftSections`. Limits, choices and defaults come from
 * the pinned runtime schema so nothing is written by hand twice.
 */

import schema from "./generated/library-config.schema.json";
import { resolveSchemaPointer } from "./section-registry";

export type SectionRow = { sectionKey: string; payload: unknown };

/** Sections this version of the page edits, in rail order. */
export const PAGE_SECTION_KEYS = ["identity", "theme", "institutions"] as const;
export type PageSectionKey = (typeof PAGE_SECTION_KEYS)[number];

export type SectionState = "complete" | "edited" | "attention";

type SectionProblem =
  | "nameMissing"
  | "partnerName"
  | "logoMissing"
  | "faviconMissing"
  | "badColour"
  | "institutionName";

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
} as const;

export const THEME_LAYOUTS = schemaEnum<"small" | "wide">("/theme/layout");
type ThemeLayout = (typeof THEME_LAYOUTS)[number];

export const THEME_MODES = schemaEnum<"light" | "dark" | "system">(
  "/theme/defaultMode",
);
type ThemeMode = (typeof THEME_MODES)[number];

export const FONT_FAMILIES = schemaEnum<string>("/theme/fonts/heading/family");
export type FontFamily = (typeof FONT_FAMILIES)[number];

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

export type ConfigurationDraft = {
  identity: IdentityDraft;
  theme: ThemeDraft;
  institutions: InstitutionDraft[];
};

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

function payloadOf(rows: readonly SectionRow[], sectionKey: PageSectionKey) {
  return rows.find((row) => row.sectionKey === sectionKey)?.payload;
}

function readIdentity(payload: unknown): IdentityDraft {
  const identity = record(payload);
  const assets = record(identity.assets);
  const partners = Array.isArray(identity.fundingPartners)
    ? identity.fundingPartners.map((partner) => {
        const row = record(partner);
        return { id: text(row.id) || newId("fp"), name: text(row.name) };
      })
    : [];
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
  if (!Array.isArray(payload)) return [];
  return payload.map((item) => {
    const row = record(item);
    return {
      id: text(row.id) || newId("inst"),
      name: text(row.name),
      logoUrl: text(row.logoUrl),
    };
  });
}

/** Builds the page draft from the saved rows. Missing rows get defaults. */
export function readDraft(rows: readonly SectionRow[]): ConfigurationDraft {
  return {
    identity: readIdentity(payloadOf(rows, "identity")),
    theme: readTheme(payloadOf(rows, "theme")),
    institutions: readInstitutions(payloadOf(rows, "institutions")),
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

function sectionPayload(
  draft: ConfigurationDraft,
  sectionKey: PageSectionKey,
): unknown {
  switch (sectionKey) {
    case "identity":
      return identityPayload(draft.identity);
    case "theme":
      return themePayload(draft.theme);
    case "institutions":
      return institutionsPayload(draft.institutions);
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function hasRow(rows: readonly SectionRow[], sectionKey: PageSectionKey) {
  return rows.some((row) => row.sectionKey === sectionKey);
}

/** Rows to send on Save: every page section whose payload differs from its saved row. */
export function changedSectionRows(
  draft: ConfigurationDraft,
  rows: readonly SectionRow[],
): { sectionKey: PageSectionKey; payload: unknown }[] {
  const saved = readDraft(rows);
  return PAGE_SECTION_KEYS.filter(
    (sectionKey) =>
      !hasRow(rows, sectionKey) ||
      !same(sectionPayload(draft, sectionKey), sectionPayload(saved, sectionKey)),
  ).map((sectionKey) => ({
    sectionKey,
    payload: sectionPayload(draft, sectionKey),
  }));
}

export const isDirty = (draft: ConfigurationDraft, rows: readonly SectionRow[]) =>
  changedSectionRows(draft, rows).length > 0;

/** Every uploaded file a draft points at: logos, favicon, share image, institution logos. */
function uploadUrls(draft: ConfigurationDraft): string[] {
  return [
    ...Object.values(draft.identity.assets),
    ...draft.institutions.map((institution) => institution.logoUrl),
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
  }
}

const ROWS_FOR_CARD: Record<PageSectionKey, readonly PageSectionKey[]> = {
  identity: ["identity"],
  theme: ["theme", "identity"],
  institutions: ["institutions"],
};

export function sectionChanged(
  draft: ConfigurationDraft,
  rows: readonly SectionRow[],
  sectionKey: PageSectionKey,
): boolean {
  if (ROWS_FOR_CARD[sectionKey].some((key) => !hasRow(rows, key))) return true;
  return !same(cardSlice(draft, sectionKey), cardSlice(readDraft(rows), sectionKey));
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
  }
  return problems;
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
  }
  return next;
}
