import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ConfigurationAssemblyError,
  assembleEvidenceLibraryConfiguration,
} from "./assembly";
import {
  type EssentialConfigurationSections,
  omitFieldsMissingFromContract,
  validateEssentialConfiguration,
} from "./essential-configuration";
import schema from "./generated/library-config.schema.json";
import { resolveSchemaPointer } from "./section-registry";
import { validateLibraryConfigStructure } from "./validation";

const visibleConfiguration = {
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
  theme: {
    colors: {
      accent: "#005A9C",
      tertiary: "#F2A900",
    },
  },
  localization: {
    locales: ["en-GB", "fr"],
    defaultLocale: "en-GB",
  },
  footer: { poweredBy: true },
} satisfies EssentialConfigurationSections;

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
      identity: {
        name: 42,
        baseUrl: "not a uri",
      },
      theme: {
        colors: {},
        layout: "boxed",
      },
      localization: {
        defaultLocale: "en-GB",
      },
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

  test("assembles a complete structurally valid runtime configuration", () => {
    const configuration = assembleEvidenceLibraryConfiguration({
      sections: visibleConfiguration,
      managed: managedConfiguration,
      now: new Date("2026-08-24T19:00:00.000Z"),
    });

    expect(validateLibraryConfigStructure(configuration)).toEqual({
      valid: true,
      issues: [],
    });
    const contractDeclaresNewFields =
      resolveSchemaPointer(schema, "/footer/poweredBy") !== undefined;
    expect(configuration).toMatchObject({
      identity: contractDeclaresNewFields
        ? visibleConfiguration.identity
        : omitFieldsMissingFromContract(visibleConfiguration).identity,
      localization: visibleConfiguration.localization,
      services: {
        database: { url: managedConfiguration.databaseUrl },
        search: {
          host: managedConfiguration.searchHost,
          index: managedConfiguration.searchIndex,
          key: managedConfiguration.searchKey,
        },
        storage: {
          url: managedConfiguration.storageUrl,
          serviceRoleKey: managedConfiguration.storageServiceRoleKey,
          privateBucket: managedConfiguration.storagePrivateBucket,
          publicBucket: managedConfiguration.storagePublicBucket,
          maxPdfBytes: managedConfiguration.storageMaxPdfBytes,
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
      institutions: [],
      navigation: {},
      filters: { years: { maximum: 2026 } },
    });

    const withoutZotero = assembleEvidenceLibraryConfiguration({
      sections: visibleConfiguration,
      managed: { ...managedConfiguration, zoteroTranslationUrl: undefined },
      now: new Date("2026-08-24T19:00:00.000Z"),
    });
    expect(
      (withoutZotero.services as Record<string, unknown>).zotero,
    ).not.toHaveProperty("translationUrl");
    expect(configuration.footer.poweredBy).toBe(
      contractDeclaresNewFields ? true : undefined,
    );
  });

  test("drops fields the pinned contract does not declare yet", () => {
    const pinned = omitFieldsMissingFromContract(visibleConfiguration, {
      properties: {
        identity: { properties: { assets: { properties: {} } } },
        footer: { properties: {} },
      },
    });
    expect(pinned.identity).not.toHaveProperty("tagline");
    expect(pinned.identity).not.toHaveProperty("description");
    expect(pinned.identity.assets).not.toHaveProperty("shareImage");
    expect(pinned).not.toHaveProperty("footer");
    expect(pinned.identity.name).toBe(visibleConfiguration.identity.name);

    const synced = omitFieldsMissingFromContract(visibleConfiguration, {
      properties: {
        identity: {
          properties: {
            tagline: {},
            description: {},
            assets: { properties: { shareImage: {} } },
          },
        },
        footer: { properties: { poweredBy: {} } },
      },
    });
    expect(synced).toEqual(visibleConfiguration);
  });

  test("keeps the OpenScholar footer credit on until plans exist", () => {
    const result = validateEssentialConfiguration({
      ...visibleConfiguration,
      footer: { poweredBy: false },
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      pointer: "/footer/poweredBy",
      section: "footer",
      keyword: "plan",
      message: "Available on paid plans.",
    });
    expect(validateEssentialConfiguration(visibleConfiguration).valid).toBe(
      true,
    );
  });

  test("reports visible and managed failures with field pointers", () => {
    const invalidLanguages = validateEssentialConfiguration({
      ...visibleConfiguration,
      localization: {
        locales: ["fr"],
        defaultLocale: "not-supported",
      },
    });
    expect(invalidLanguages.issues.map((issue) => issue.pointer)).toContain(
      "/localization/defaultLocale",
    );

    expect(() =>
      assembleEvidenceLibraryConfiguration({
        sections: {
          ...visibleConfiguration,
          identity: {
            ...visibleConfiguration.identity,
            assets: {
              ...visibleConfiguration.identity.assets,
              favicon: "not a URL",
            },
          },
        },
        managed: {
          ...managedConfiguration,
          authenticationSecret: "",
        },
      }),
    ).toThrow(ConfigurationAssemblyError);

    try {
      assembleEvidenceLibraryConfiguration({
        sections: {
          ...visibleConfiguration,
          identity: {
            ...visibleConfiguration.identity,
            assets: {
              ...visibleConfiguration.identity.assets,
              favicon: "not a URL",
            },
          },
        },
        managed: {
          ...managedConfiguration,
          authenticationSecret: "",
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationAssemblyError);
      expect(
        (error as ConfigurationAssemblyError).issues.map(
          (issue) => issue.pointer,
        ),
      ).toEqual(
        expect.arrayContaining([
          "/authentication/secret",
          "/identity/assets/favicon",
        ]),
      );
    }
  });
});
