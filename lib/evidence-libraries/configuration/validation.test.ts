import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ConfigurationAssemblyError,
  assembleEvidenceLibraryConfiguration,
} from "./assembly";
import { initialLocalizationPayload } from "./initial-sections";
import { validateOwnerSection, validateOwnerSections } from "./owner-rules";
import { REQUIRED_OWNER_SECTION_KEYS } from "./section-registry";
import { validateLibraryConfigStructure } from "./validation";

const ownerSections = {
  identity: {
    name: "Climate Evidence Library",
    shortName: "Climate Evidence",
    tagline: "Evidence for climate decisions",
    description: "A curated library of climate research.",
    baseUrl: "https://climate-lib.libraries.example.test",
    assets: {
      logoDark: "https://assets.example.test/climate-logo.svg",
      favicon: "https://assets.example.test/climate-favicon.ico",
      shareImage: "https://assets.example.test/climate-share.png",
    },
  },
  theme: { colors: { accent: "#005A9C", tertiary: "#F2A900" } },
  localization: { locales: ["en-GB", "fr"], defaultLocale: "en-GB" },
  footer: { poweredBy: true, disclaimer: "Views are the authors' own." },
  navigation: {
    links: [{ id: "home", label: "Home", href: "/", target: "blank" }],
  },
  filters: { years: { minimum: 2000 } },
  features: { collections: false, countryFocus: false },
};

const managedConfiguration = {
  revision: "r2",
  updatedAt: "2026-08-24T19:00:00.000Z",
  libraryId: "j57climate32",
  convexSiteUrl: "https://lane.example.convex.site",
  loginPageUrl:
    "https://app.example.test/evidence-libraries/j57climate32/admin",
  machineCredential: `els_${"a".repeat(43)}`,
  authenticationSecret: "a".repeat(32),
  databaseUrl: "postgresql://library:password@db.example.test:5432/library",
  searchHost: "https://search.example.test",
  searchKey: "search-key",
  searchIndex: "climate_library",
  storageUrl: "https://storage.example.test",
  storageServiceRoleKey: "storage-service-role-key",
  storagePrivateBucket: "climate-private",
  storagePublicBucket: "climate-public",
  storageMaxPdfBytes: 52_428_800,
  zoteroTranslationUrl: "https://translation.example.test",
};

describe("validateLibraryConfigStructure", () => {
  test("normalizes required, format, and enum failures to stable field pointers", () => {
    const result = validateLibraryConfigStructure({
      schemaVersion: 1,
      revision: "candidate-1",
      updatedAt: "2026-08-11T10:00:00Z",
      identity: { name: 42, baseUrl: "not a uri" },
      theme: { colors: {}, layout: "boxed" },
      localization: { defaultLocale: "en-GB" },
      services: {},
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        {
          pointer: "/identity/assets",
          section: "identity",
          keyword: "required",
          message: "Required field is missing.",
        },
        {
          pointer: "/identity/baseUrl",
          section: "identity",
          keyword: "format",
          message: "Value must match the uri format.",
        },
        {
          pointer: "/identity/name",
          section: "identity",
          keyword: "type",
          message: "Value must be a string.",
        },
        {
          pointer: "/theme/layout",
          section: "theme",
          keyword: "enum",
          message: "Value must be one of: small, wide.",
        },
      ]),
    );
  });
});

describe("validateOwnerSection", () => {
  test("checks a payload against its own schema slice with root pointers", () => {
    const result = validateOwnerSection("navigation", {
      links: [{ id: "home", label: "Home", href: "/", target: "nowhere" }],
      unexpected: true,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.pointer)).toEqual(
      expect.arrayContaining([
        "/navigation/links/0/target",
        "/navigation/unexpected",
      ]),
    );
    expect(validateOwnerSection("footer", ownerSections.footer).valid).toBe(
      true,
    );
  });

  test("keeps the footer credit on and the public address fixed", () => {
    expect(
      validateOwnerSection("footer", { poweredBy: false }).issues,
    ).toContainEqual({
      pointer: "/footer/poweredBy",
      section: "footer",
      keyword: "plan",
      message: "Available on paid plans.",
    });
    expect(
      validateOwnerSection("identity", ownerSections.identity, {
        expectedBaseUrl: "https://other.libraries.example.test",
      }).issues.map((issue) => issue.pointer),
    ).toEqual(["/identity/baseUrl"]);
  });
});

describe("validateOwnerSections", () => {
  test("reports duplicate rows and, when asked, the required sections that are missing", () => {
    expect(REQUIRED_OWNER_SECTION_KEYS).toEqual([
      "identity",
      "theme",
      "localization",
    ]);
    const partial = validateOwnerSections([
      { sectionKey: "footer", payload: ownerSections.footer },
      { sectionKey: "footer", payload: ownerSections.footer },
    ]);
    expect(partial.issues).toEqual([
      expect.objectContaining({ pointer: "/footer", keyword: "duplicate" }),
    ]);
    const complete = validateOwnerSections(
      [
        { sectionKey: "identity", payload: ownerSections.identity },
        { sectionKey: "localization", payload: initialLocalizationPayload() },
      ],
      { requireComplete: true },
    );
    expect(complete.issues).toEqual([
      expect.objectContaining({ pointer: "/theme", keyword: "required" }),
    ]);
  });
});

describe("assembleEvidenceLibraryConfiguration", () => {
  test("merges every saved section over schema defaults and platform values", () => {
    const configuration = assembleEvidenceLibraryConfiguration({
      sections: ownerSections,
      managed: managedConfiguration,
      now: new Date("2026-08-24T19:00:00.000Z"),
    });

    expect(validateLibraryConfigStructure(configuration)).toEqual({
      valid: true,
      issues: [],
    });
    expect(configuration).toMatchObject({
      identity: ownerSections.identity,
      localization: ownerSections.localization,
      navigation: ownerSections.navigation,
      footer: { poweredBy: true, disclaimer: "Views are the authors' own." },
      filters: { years: { minimum: 2000, maximum: 2026 } },
      features: { collections: false, countryFocus: false, login: false },
      // Sections that were never saved come from the schema defaults.
      institutions: [],
      contact: {},
      citations: { showUrl: false },
      search: { embedder: null },
      services: {
        database: { url: managedConfiguration.databaseUrl },
        search: {
          host: managedConfiguration.searchHost,
          index: managedConfiguration.searchIndex,
          key: managedConfiguration.searchKey,
        },
        zotero: { translationUrl: managedConfiguration.zoteroTranslationUrl },
      },
      authentication: {
        openScholar: {
          convexSiteUrl: managedConfiguration.convexSiteUrl,
          libraryId: managedConfiguration.libraryId,
          loginPageUrl: managedConfiguration.loginPageUrl,
          machineCredential: managedConfiguration.machineCredential,
        },
        secret: managedConfiguration.authenticationSecret,
      },
    });

    const withoutZotero = assembleEvidenceLibraryConfiguration({
      sections: ownerSections,
      managed: { ...managedConfiguration, zoteroTranslationUrl: undefined },
      now: new Date("2026-08-24T19:00:00.000Z"),
    });
    expect(
      (withoutZotero.services as Record<string, unknown>).zotero,
    ).not.toHaveProperty("translationUrl");
  });

  test("ignores owner rows for platform sections and hands sources to the credential hook", () => {
    const configuration = assembleEvidenceLibraryConfiguration({
      sections: {
        ...ownerSections,
        services: { database: { url: "postgresql://owner-wrote-this" } },
        sources: [
          { key: "main", provider: "zotero", groupId: "12345" },
        ],
      },
      managed: managedConfiguration,
      applySourceCredentials: (sources) =>
        sources.map((source) => ({ ...source, apiKey: `key-${source.groupId}` })),
    });
    expect(configuration.services.database.url).toBe(
      managedConfiguration.databaseUrl,
    );
    expect(configuration.sources).toEqual([
      expect.objectContaining({
        key: "main",
        groupId: "12345",
        apiKey: "key-12345",
        enabled: true,
      }),
    ]);
  });

  test("reports owner and platform failures with field pointers", () => {
    const broken = {
      sections: {
        ...ownerSections,
        identity: {
          ...ownerSections.identity,
          assets: { ...ownerSections.identity.assets, favicon: "not a URL" },
        },
      },
      managed: { ...managedConfiguration, authenticationSecret: "" },
    };
    expect(() => assembleEvidenceLibraryConfiguration(broken)).toThrow(
      ConfigurationAssemblyError,
    );
    try {
      assembleEvidenceLibraryConfiguration(broken);
    } catch (error) {
      expect(
        (error as ConfigurationAssemblyError).issues.map((issue) => issue.pointer),
      ).toEqual(
        expect.arrayContaining([
          "/authentication/secret",
          "/identity/assets/favicon",
        ]),
      );
    }
    expect(() =>
      assembleEvidenceLibraryConfiguration({
        sections: { identity: ownerSections.identity },
        managed: managedConfiguration,
      }),
    ).toThrow(ConfigurationAssemblyError);
  });
});
