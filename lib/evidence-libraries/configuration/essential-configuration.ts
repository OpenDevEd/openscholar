import schema from "./generated/library-config.schema.json";
import {
  validateEssentialConfigStructure,
  type ValidationIssue,
} from "./generated-validation";
import { resolveSchemaPointer } from "./section-registry";

export type EssentialIdentitySection = {
  name: string;
  shortName: string;
  tagline?: string;
  description?: string;
  baseUrl: string;
  assets: {
    logoDark: string;
    favicon: string;
    shareImage?: string;
  };
};

export type EssentialThemeSection = {
  colors: {
    accent: string;
    tertiary: string;
  };
};

export type EssentialLocalizationSection = {
  locales: string[];
  defaultLocale: string;
};

export type EssentialFooterSection = {
  poweredBy: boolean;
};

export type EssentialConfigurationSections = {
  identity: EssentialIdentitySection;
  theme: EssentialThemeSection;
  localization: EssentialLocalizationSection;
  footer: EssentialFooterSection;
};

export type EssentialConfigurationIssue = ValidationIssue;

/**
 * Fields the Evidence Library runtime added after the pinned contract was
 * last synced. Until the integration owner re-syncs the contract, the pinned
 * schema rejects these keys, so they are removed before structural validation
 * and before assembly. Once the synced schema declares a pointer, that field
 * passes through unchanged. Delete this list after the sync lands.
 */
export const PENDING_CONTRACT_FIELDS = [
  "/identity/tagline",
  "/identity/description",
  "/identity/assets/shareImage",
  "/footer/poweredBy",
] as const;

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function withoutPointer(value: unknown, tokens: string[]): unknown {
  const object = objectValue(value);
  if (!object || tokens.length === 0) return value;
  const [head, ...rest] = tokens;
  if (!(head! in object)) return value;
  const next = { ...object };
  if (rest.length === 0) {
    delete next[head!];
  } else {
    next[head!] = withoutPointer(object[head!], rest);
  }
  return next;
}

export function omitFieldsMissingFromContract<T>(
  sections: T,
  contractSchema: unknown = schema,
): T {
  let result: unknown = sections;
  for (const pointer of PENDING_CONTRACT_FIELDS) {
    if (resolveSchemaPointer(contractSchema, pointer) !== undefined) continue;
    result = withoutPointer(result, pointer.slice(1).split("/"));
    // A footer that only carries the pending field must disappear entirely
    // because the pinned essential validator does not accept a footer yet.
    const footer = objectValue(objectValue(result)?.footer);
    if (footer && Object.keys(footer).length === 0) {
      result = withoutPointer(result, ["footer"]);
    }
  }
  return result as T;
}

export function validateEssentialConfiguration(
  sections: unknown,
  options: { expectedBaseUrl?: string } = {},
): {
  valid: boolean;
  issues: EssentialConfigurationIssue[];
  value?: EssentialConfigurationSections;
} {
  const structural = validateEssentialConfigStructure(
    omitFieldsMissingFromContract(sections),
  );
  const issues = [...structural.issues];
  const root = objectValue(sections);
  const identity = objectValue(root?.identity);
  if (
    options.expectedBaseUrl !== undefined &&
    typeof identity?.baseUrl === "string" &&
    identity.baseUrl !== options.expectedBaseUrl
  ) {
    issues.push({
      pointer: "/identity/baseUrl",
      section: "identity",
      keyword: "platformAddress",
      message: "The generated public address cannot be changed.",
    });
  }
  // There is no plan model yet. Every library counts as a free plan, so the
  // "Powered by OpenScholar" footer credit stays on. Plan gating comes later.
  if (objectValue(root?.footer)?.poweredBy === false) {
    issues.push({
      pointer: "/footer/poweredBy",
      section: "footer",
      keyword: "plan",
      message: "Available on paid plans.",
    });
  }

  if (issues.length > 0) return { valid: false, issues };
  return {
    valid: true,
    issues: [],
    value: sections as EssentialConfigurationSections,
  };
}
