import {
  validateEssentialConfigStructure,
  type ValidationIssue,
} from "./generated-validation";

export type EssentialIdentitySection = {
  name: string;
  shortName: string;
  baseUrl: string;
  assets: {
    logoDark: string;
    favicon: string;
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

export type EssentialConfigurationSections = {
  identity: EssentialIdentitySection;
  theme: EssentialThemeSection;
  localization: EssentialLocalizationSection;
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
  const identity = objectValue(objectValue(sections)?.identity);
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

  if (issues.length > 0) return { valid: false, issues };
  return {
    valid: true,
    issues: [],
    value: sections as EssentialConfigurationSections,
  };
}
