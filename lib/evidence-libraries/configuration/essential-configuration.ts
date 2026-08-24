import schema from "./generated/library-config.schema.json";
import { resolveSchemaPointer } from "./section-registry";

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

export type EssentialConfigurationIssue = {
  pointer: string;
  message: string;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

type GeneratedStringContract = {
  enum?: string[];
  format?: string;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
};

type GeneratedArrayContract = {
  items?: GeneratedStringContract;
  maxItems?: number;
  minItems?: number;
};

function stringContract(pointer: string): GeneratedStringContract {
  const contract = resolveSchemaPointer(schema, pointer);
  if (!contract || typeof contract !== "object") {
    throw new Error(`Generated configuration contract is missing ${pointer}`);
  }
  return contract as GeneratedStringContract;
}

function arrayContract(pointer: string): GeneratedArrayContract {
  const contract = resolveSchemaPointer(schema, pointer);
  if (!contract || typeof contract !== "object") {
    throw new Error(`Generated configuration contract is missing ${pointer}`);
  }
  return contract as GeneratedArrayContract;
}

function validateString(
  issues: EssentialConfigurationIssue[],
  pointer: string,
  value: unknown,
): value is string {
  const contract = stringContract(pointer);
  if (typeof value !== "string") {
    issues.push({ pointer, message: "Value must be text." });
    return false;
  }

  const length = Array.from(value).length;
  if (contract.minLength !== undefined && length < contract.minLength) {
    issues.push({ pointer, message: "Value is too short." });
  }
  if (contract.maxLength !== undefined && length > contract.maxLength) {
    issues.push({ pointer, message: "Value is too long." });
  }
  if (contract.pattern && !new RegExp(contract.pattern, "u").test(value)) {
    issues.push({ pointer, message: "Value does not match the required format." });
  }
  if (contract.enum && !contract.enum.includes(value)) {
    issues.push({ pointer, message: "Value is not an available option." });
  }
  if (contract.format === "uri") {
    try {
      new URL(value);
    } catch {
      issues.push({ pointer, message: "Value must be a valid URL." });
    }
  }
  return true;
}

function validateLocales(
  issues: EssentialConfigurationIssue[],
  value: unknown,
): value is string[] {
  const pointer = "/localization/locales";
  const contract = arrayContract(pointer);
  if (!Array.isArray(value)) {
    issues.push({ pointer, message: "Available languages must be a list." });
    return false;
  }
  if (contract.minItems !== undefined && value.length < contract.minItems) {
    issues.push({ pointer, message: "Select at least one available language." });
  }
  if (contract.maxItems !== undefined && value.length > contract.maxItems) {
    issues.push({ pointer, message: "Too many available languages were selected." });
  }

  const seen = new Set<string>();
  for (const [index, locale] of value.entries()) {
    const itemPointer = `${pointer}/${index}`;
    if (typeof locale !== "string" || !contract.items?.enum?.includes(locale)) {
      issues.push({ pointer: itemPointer, message: "Language is not available." });
      continue;
    }
    if (seen.has(locale)) {
      issues.push({ pointer: itemPointer, message: "Language is selected more than once." });
    }
    seen.add(locale);
  }
  return value.every((locale) => typeof locale === "string");
}

export function validateEssentialConfiguration(
  sections: unknown,
  options: { expectedBaseUrl?: string } = {},
): {
  valid: boolean;
  issues: EssentialConfigurationIssue[];
  value?: EssentialConfigurationSections;
} {
  const issues: EssentialConfigurationIssue[] = [];
  const root = asObject(sections);
  const identity = asObject(root?.identity);
  const assets = asObject(identity?.assets);
  const theme = asObject(root?.theme);
  const colors = asObject(theme?.colors);
  const localization = asObject(root?.localization);
  const name = identity?.name;
  const shortName = identity?.shortName;
  const baseUrl = identity?.baseUrl;
  const logoDark = assets?.logoDark;
  const favicon = assets?.favicon;
  const accent = colors?.accent;
  const tertiary = colors?.tertiary;
  const locales = localization?.locales;
  const defaultLocale = localization?.defaultLocale;

  const nameIsString = validateString(
    issues,
    "/identity/name",
    name,
  );
  const shortNameIsString = validateString(
    issues,
    "/identity/shortName",
    shortName,
  );
  const baseUrlIsString = validateString(
    issues,
    "/identity/baseUrl",
    baseUrl,
  );
  const logoIsString = validateString(
    issues,
    "/identity/assets/logoDark",
    logoDark,
  );
  const faviconIsString = validateString(
    issues,
    "/identity/assets/favicon",
    favicon,
  );
  const accentIsString = validateString(
    issues,
    "/theme/colors/accent",
    accent,
  );
  const tertiaryIsString = validateString(
    issues,
    "/theme/colors/tertiary",
    tertiary,
  );
  const localesAreStrings = validateLocales(
    issues,
    locales,
  );
  const defaultLocaleIsString = validateString(
    issues,
    "/localization/defaultLocale",
    defaultLocale,
  );

  if (
    options.expectedBaseUrl !== undefined &&
    baseUrlIsString &&
    baseUrl !== options.expectedBaseUrl
  ) {
    issues.push({
      pointer: "/identity/baseUrl",
      message: "The generated public address cannot be changed.",
    });
  }
  if (
    localesAreStrings &&
    defaultLocaleIsString &&
    !locales.includes(defaultLocale)
  ) {
    issues.push({
      pointer: "/localization/defaultLocale",
      message: "Default language must be one of the available languages.",
    });
  }

  const valid = issues.length === 0;
  return {
    valid,
    issues,
    value:
      valid &&
      nameIsString &&
      shortNameIsString &&
      baseUrlIsString &&
      logoIsString &&
      faviconIsString &&
      accentIsString &&
      tertiaryIsString &&
      localesAreStrings &&
      defaultLocaleIsString
        ? {
            identity: {
              name,
              shortName,
              baseUrl,
              assets: {
                logoDark,
                favicon,
              },
            },
            theme: {
              colors: {
                accent,
                tertiary,
              },
            },
            localization: {
              locales,
              defaultLocale,
            },
          }
        : undefined,
  };
}
