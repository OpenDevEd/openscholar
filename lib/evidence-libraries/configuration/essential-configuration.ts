import {
  validateEssentialConfigStructure,
  type ValidationIssue,
} from "./generated-validation";

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

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function validateEssentialConfiguration(
  sections: unknown,
  options: { expectedBaseUrl?: string } = {},
): {
  valid: boolean;
  issues: EssentialConfigurationIssue[];
  value?: EssentialConfigurationSections;
} {
  const structural = validateEssentialConfigStructure(sections);
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
