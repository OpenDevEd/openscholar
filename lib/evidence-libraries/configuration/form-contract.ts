import "server-only";

import catalogs from "./generated/library-config.catalogs.json";
import schema from "./generated/library-config.schema.json";
import { resolveSchemaPointer } from "./section-registry";

type StringFieldContract = {
  maxLength?: number;
  minLength?: number;
  pattern?: string;
};

export type EssentialConfigurationFormContract = {
  fields: {
    name: StringFieldContract;
    shortName: StringFieldContract;
    tagline: StringFieldContract;
    description: StringFieldContract;
    logo: StringFieldContract;
    favicon: StringFieldContract;
    shareImage: StringFieldContract;
    colour: StringFieldContract;
  };
  locales: string[];
};

function readStringContract(pointer: string): StringFieldContract {
  const value = resolveSchemaPointer(schema, pointer);
  if (!value || typeof value !== "object") {
    throw new Error(`Generated configuration contract is missing ${pointer}`);
  }
  const contract = value as StringFieldContract;
  return {
    maxLength: contract.maxLength,
    minLength: contract.minLength,
    pattern: contract.pattern,
  };
}

// Limits the runtime uses for fields the pinned contract does not declare yet.
// The synced schema wins as soon as it declares the pointer.
const PENDING_FIELD_LIMITS = {
  "/identity/tagline": { maxLength: 160 },
  "/identity/description": { maxLength: 300 },
  "/identity/assets/shareImage": { minLength: 1, maxLength: 2048 },
} satisfies Record<string, StringFieldContract>;

function readPendingStringContract(
  pointer: keyof typeof PENDING_FIELD_LIMITS,
): StringFieldContract {
  return resolveSchemaPointer(schema, pointer)
    ? readStringContract(pointer)
    : PENDING_FIELD_LIMITS[pointer];
}

function readLocales() {
  const field = catalogs.fields.enums.find(
    (entry) => entry.path === "localization.locales[]",
  );
  if (!field || field.values.length === 0) {
    throw new Error("Generated configuration catalog has no languages");
  }
  const locales = field.values.filter(
    (value): value is string => typeof value === "string",
  );
  if (locales.length !== field.values.length) {
    throw new Error("Generated configuration catalog has an invalid language");
  }
  return locales;
}

export function getEssentialConfigurationFormContract(): EssentialConfigurationFormContract {
  return {
    fields: {
      name: readStringContract("/identity/name"),
      shortName: readStringContract("/identity/shortName"),
      tagline: readPendingStringContract("/identity/tagline"),
      description: readPendingStringContract("/identity/description"),
      logo: readStringContract("/identity/assets/logoDark"),
      favicon: readStringContract("/identity/assets/favicon"),
      shareImage: readPendingStringContract("/identity/assets/shareImage"),
      colour: readStringContract("/theme/colors/accent"),
    },
    locales: readLocales(),
  };
}
