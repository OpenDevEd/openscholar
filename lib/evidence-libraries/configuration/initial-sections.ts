import catalogs from "./generated/library-config.catalogs.json";

// The rows a new library starts with. Every other section stays absent until
// the owner saves it; absent means the schema defaults apply at assembly.
export function initialIdentityPayload(input: {
  name: string;
  shortName: string;
  baseUrl: string;
}) {
  return { baseUrl: input.baseUrl, name: input.name, shortName: input.shortName };
}

export function initialLocalizationPayload() {
  const field = catalogs.fields.enums.find(
    (entry) => entry.path === "localization.defaultLocale",
  );
  const defaultLocale = field?.values[0];
  if (typeof defaultLocale !== "string") {
    throw new Error("Generated configuration catalog has no default language");
  }
  return { locales: [defaultLocale], defaultLocale };
}
