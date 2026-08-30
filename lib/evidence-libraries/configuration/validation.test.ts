import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ConfigurationAssemblyError,
  assembleEvidenceLibraryConfiguration,
} from "./assembly";
import {
  AI_MODELS,
  AI_PROVIDER,
  PLATFORM_EMBEDDING_KEY_MISSING_MESSAGE,
  platformEmbeddingKey,
  platformSearchEmbedder,
} from "./ai";
import { createAiProviderKey } from "@/convex/evidenceLibraries/aiProviderKey";
import { initialLocalizationPayload } from "./initial-sections";
import { validateOwnerSection, validateOwnerSections } from "./owner-rules";
import { REQUIRED_OWNER_SECTION_KEYS } from "./section-registry";
import { validateLibraryConfigStructure } from "./generated-validation";

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

const platformMail = {
  host: "smtp.example.test",
  port: 465,
  security: "tls" as const,
  from: "no-reply@example.test",
  username: "mailer",
  password: "mail-password",
};

const platformBrand = {
  logoUrl: "https://storage.example.test/storage/v1/object/public/openscholar/platform/openscholar-logo.svg",
  faviconUrl: "https://storage.example.test/storage/v1/object/public/openscholar/platform/openscholar-favicon.png",
};

const emailWithRecipients = {
  contactRecipient: "team@example.org",
  takedownRecipient: "takedown@example.org",
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

  test("lets a draft carry a source without its write-only key", () => {
    expect(
      validateOwnerSection("sources", [
        {
          key: "zotero-42",
          provider: "zotero",
          groupId: "42",
          enabled: true,
          writebackEnabled: false,
        },
      ]).issues,
    ).toEqual([]);
    expect(
      validateOwnerSection("sources", [{ groupId: "42" }]).issues.map(
        (issue) => issue.pointer,
      ),
    ).toEqual(["/sources/0/key", "/sources/0/provider"]);
  });
});

describe("validateOwnerSection brand assets", () => {
  test("accepts an identity without a logo or favicon; the platform fills them", () => {
    const { assets: _assets, ...withoutAssets } = ownerSections.identity;
    expect(validateOwnerSection("identity", withoutAssets).issues).toEqual([]);
    expect(
      validateOwnerSection("identity", { ...withoutAssets, assets: {} }).issues,
    ).toEqual([]);
    expect(
      validateOwnerSection("identity", {
        ...withoutAssets,
        assets: { logoDark: "not a URL" },
      }).issues.map((issue) => issue.pointer),
    ).toEqual(["/identity/assets/logoDark"]);
  });
});

describe("validateOwnerSection email rules", () => {
  test("refuses a mail server in the owner row", () => {
    const result = validateOwnerSection("email", {
      ...emailWithRecipients,
      smtp: { host: "owner.example.test" },
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ pointer: "/email/smtp", keyword: "platformValue" }),
    ]);
  });

  test("refuses recipients when the platform has no mail service", () => {
    const withoutMail = validateOwnerSection("email", emailWithRecipients, {
      platformMailConfigured: false,
    });
    expect(withoutMail.issues).toEqual([
      expect.objectContaining({
        pointer: "/email/smtp/host",
        keyword: "platformMail",
      }),
    ]);
    expect(
      validateOwnerSection("email", {}, { platformMailConfigured: false }).valid,
    ).toBe(true);
    expect(
      validateOwnerSection("email", emailWithRecipients, {
        platformMailConfigured: true,
      }).valid,
    ).toBe(true);
  });
});

describe("validateOwnerSections", () => {
  test("accepts export switches and refuses the old file addresses", () => {
    expect(
      validateOwnerSections([{ sectionKey: "exports", payload: { ris: true, bibtex: false, atom: true } }]).issues,
    ).toEqual([]);
    expect(
      validateOwnerSections([{ sectionKey: "exports", payload: { ris: "https://feeds.example.test/library.ris" } }])
        .issues,
    ).toEqual([expect.objectContaining({ pointer: "/exports/ris" })]);
  });

  test("reports duplicate rows and, when asked, the required sections that are missing", () => {
    expect(REQUIRED_OWNER_SECTION_KEYS).toEqual([
      "identity",
      "theme",
      "localization",
    ]);
    const partial = validateOwnerSections([
      { sectionKey: "footer", payload: ownerSections.footer },
      { sectionKey: "footer", payload: ownerSections.footer },
      { sectionKey: "services", payload: {} },
      { sectionKey: "authentication", payload: {} },
    ]);
    expect(partial.issues).toEqual([
      expect.objectContaining({ pointer: "/footer", keyword: "duplicate" }),
      expect.objectContaining({ pointer: "/services", keyword: "platformSection" }),
      expect.objectContaining({
        pointer: "/authentication",
        keyword: "platformSection",
      }),
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

  test("gives only the switched-on OpenRouter entry the stored key", () => {
    const apply = createAiProviderKey("sk-or-stored");
    expect(
      apply([
        {
          provider: AI_PROVIDER,
          enabled: true,
          models: [AI_MODELS[0]],
          defaultModel: AI_MODELS[0],
        },
      ]),
    ).toEqual([
      {
        provider: AI_PROVIDER,
        enabled: true,
        models: [AI_MODELS[0]],
        defaultModel: AI_MODELS[0],
        apiKey: "sk-or-stored",
      },
    ]);
    // A switched-off entry never needs a key and never receives one.
    expect(
      createAiProviderKey(undefined)([{ provider: AI_PROVIDER, enabled: false }]),
    ).toEqual([{ provider: AI_PROVIDER, enabled: false }]);
    expect(() =>
      createAiProviderKey(undefined)([{ provider: AI_PROVIDER, enabled: true }]),
    ).toThrow(ConfigurationAssemblyError);
  });

  test("never hands the key to another vendor, a second provider, or none", () => {
    const apply = createAiProviderKey("sk-or-stored");
    expect(() => apply([])).toThrow(ConfigurationAssemblyError);
    expect(() => apply([{ provider: "openai", enabled: true }])).toThrow(
      ConfigurationAssemblyError,
    );
    expect(() =>
      apply([
        { provider: AI_PROVIDER, enabled: true, defaultModel: AI_MODELS[0] },
        { provider: AI_PROVIDER, enabled: true, defaultModel: AI_MODELS[0] },
      ]),
    ).toThrow(ConfigurationAssemblyError);
  });

  test.each([
    [
      "another vendor",
      [{ provider: "openai", enabled: true, defaultModel: "gpt-5.4" }],
      true,
      "/ai/providers/0/provider",
    ],
    [
      "two providers",
      [
        { provider: AI_PROVIDER, enabled: true, defaultModel: AI_MODELS[0] },
        { provider: AI_PROVIDER, enabled: false },
      ],
      true,
      "/ai/providers",
    ],
    [
      "no model on a switched-on entry",
      [{ provider: AI_PROVIDER, enabled: true }],
      true,
      "/ai/providers/0/models",
    ],
    [
      "a model the runtime does not offer",
      [
        {
          provider: AI_PROVIDER,
          enabled: true,
          models: ["made-up/model"],
          defaultModel: "made-up/model",
        },
      ],
      true,
      "/ai/providers/0/models/0",
    ],
    [
      "a provider switched on while AI answers are off",
      [
        {
          provider: AI_PROVIDER,
          enabled: true,
          models: [AI_MODELS[0]],
          defaultModel: AI_MODELS[0],
        },
      ],
      false,
      "/ai/providers/0/enabled",
    ],
    ["AI answers on with no provider at all", [], true, "/ai/providers"],
    // An AI row that is there must hold one provider, even with AI off. Only
    // a library that never saved the row has none.
    ["a saved AI row with no provider", [], false, "/ai/providers"],
  ])(
    "refuses %s when the configuration is assembled",
    (_name, providers, featuresAi, pointer) => {
      const input = {
        sections: {
          ...ownerSections,
          features: { ...ownerSections.features, ai: featuresAi },
          ai: { providers },
        },
        managed: managedConfiguration,
        applyAiProviderKey: createAiProviderKey("sk-or-stored"),
      };
      expect(() => assembleEvidenceLibraryConfiguration(input)).toThrow(
        ConfigurationAssemblyError,
      );
      try {
        assembleEvidenceLibraryConfiguration(input);
      } catch (error) {
        expect((error as ConfigurationAssemblyError).issues).toContainEqual(
          expect.objectContaining({ pointer, section: "ai" }),
        );
      }
    },
  );

  test(
    "puts the AI key into the assembled configuration and nowhere else",
    () => {
      const configuration = assembleEvidenceLibraryConfiguration({
        sections: {
          ...ownerSections,
          features: { ...ownerSections.features, ai: true },
          ai: {
            providers: [
              {
                provider: AI_PROVIDER,
                enabled: true,
                models: [AI_MODELS[0]],
                defaultModel: AI_MODELS[0],
              },
            ],
          },
        },
        managed: { ...managedConfiguration, embeddingApiKey: "sk-or-embed" },
        applyAiProviderKey: createAiProviderKey("sk-or-stored"),
      });
      expect(validateLibraryConfigStructure(configuration)).toEqual({
        valid: true,
        issues: [],
      });
      expect(configuration.ai).toEqual({
        providers: [
          {
            provider: AI_PROVIDER,
            enabled: true,
            models: [AI_MODELS[0]],
            defaultModel: AI_MODELS[0],
            apiKey: "sk-or-stored",
          },
        ],
        prompts: {},
      });
    },
  );

  test("writes the platform embedder and switches AI search on with AI answers", () => {
    const configuration = assembleEvidenceLibraryConfiguration({
      sections: {
        ...ownerSections,
        features: { ...ownerSections.features, ai: true },
        ai: {
          providers: [
            {
              provider: AI_PROVIDER,
              enabled: true,
              models: [AI_MODELS[0]],
              defaultModel: AI_MODELS[0],
            },
          ],
        },
      },
      managed: { ...managedConfiguration, embeddingApiKey: "sk-or-embed" },
      applyAiProviderKey: createAiProviderKey("sk-or-stored"),
    });
    expect(validateLibraryConfigStructure(configuration)).toEqual({
      valid: true,
      issues: [],
    });
    expect(configuration.search).toMatchObject({
      embedder: {
        source: "rest",
        url: "https://openrouter.ai/api/v1/embeddings",
        apiKey: "sk-or-embed",
        dimensions: 1024,
        request: {
          model: "perplexity/pplx-embed-v1-0.6b",
          input: ["{{text}}", "{{..}}"],
        },
        response: { data: [{ embedding: "{{embedding}}" }, "{{..}}"] },
      },
    });
    expect(configuration.features).toMatchObject({
      ai: true,
      aiSearch: true,
      deepResearch: false,
    });
  });

  test("leaves the embedder out and AI search off when AI answers are off", () => {
    const configuration = assembleEvidenceLibraryConfiguration({
      sections: {
        ...ownerSections,
        features: { ...ownerSections.features, ai: false, aiSearch: true },
      },
      managed: { ...managedConfiguration, embeddingApiKey: "sk-or-embed" },
    });
    expect(validateLibraryConfigStructure(configuration).valid).toBe(true);
    expect(configuration.search).toMatchObject({ embedder: null });
    expect(configuration.features).toMatchObject({
      ai: false,
      aiSearch: false,
    });
  });

  test("refuses AI answers when the platform has no embedding key", () => {
    const input = {
      sections: {
        ...ownerSections,
        features: { ...ownerSections.features, ai: true },
        ai: {
          providers: [
            {
              provider: AI_PROVIDER,
              enabled: true,
              models: [AI_MODELS[0]],
              defaultModel: AI_MODELS[0],
            },
          ],
        },
      },
      managed: managedConfiguration,
      applyAiProviderKey: createAiProviderKey("sk-or-stored"),
    };
    expect(() => assembleEvidenceLibraryConfiguration(input)).toThrow(
      ConfigurationAssemblyError,
    );
    try {
      assembleEvidenceLibraryConfiguration(input);
    } catch (error) {
      expect((error as ConfigurationAssemblyError).issues).toContainEqual({
        pointer: "/search/embedder",
        section: "ai",
        keyword: "platformEmbedder",
        message: PLATFORM_EMBEDDING_KEY_MISSING_MESSAGE,
      });
    }
  });

  test("keeps deep research off even when a saved row asks for it", () => {
    const configuration = assembleEvidenceLibraryConfiguration({
      sections: {
        ...ownerSections,
        features: { ...ownerSections.features, ai: true, deepResearch: true },
        ai: {
          providers: [
            {
              provider: AI_PROVIDER,
              enabled: true,
              models: [AI_MODELS[0]],
              defaultModel: AI_MODELS[0],
            },
          ],
        },
      },
      managed: { ...managedConfiguration, embeddingApiKey: "sk-or-embed" },
      applyAiProviderKey: createAiProviderKey("sk-or-stored"),
    });
    expect(validateLibraryConfigStructure(configuration).valid).toBe(true);
    expect(configuration.features).toMatchObject({
      ai: true,
      aiSearch: true,
      deepResearch: false,
    });
  });

  test("adds the platform mail service under the owner's recipients", () => {
    const configuration = assembleEvidenceLibraryConfiguration({
      sections: {
        ...ownerSections,
        email: { ...emailWithRecipients, smtp: { host: "owner.example.test" } },
      },
      managed: { ...managedConfiguration, mail: platformMail },
    });
    expect(configuration.email).toEqual({
      ...emailWithRecipients,
      smtp: platformMail,
    });
    expect(validateLibraryConfigStructure(configuration).valid).toBe(true);
  });

  test("fills a missing logo and favicon from the platform brand, owner uploads win", () => {
    const { assets: _assets, ...identityWithoutAssets } = ownerSections.identity;
    const filled = assembleEvidenceLibraryConfiguration({
      sections: { ...ownerSections, identity: identityWithoutAssets },
      managed: { ...managedConfiguration, brand: platformBrand },
    });
    expect(validateLibraryConfigStructure(filled).valid).toBe(true);
    expect(filled.identity).toMatchObject({
      assets: { logoDark: platformBrand.logoUrl, favicon: platformBrand.faviconUrl },
    });

    const partial = assembleEvidenceLibraryConfiguration({
      sections: {
        ...ownerSections,
        identity: {
          ...identityWithoutAssets,
          assets: { favicon: "https://assets.example.test/own-favicon.svg" },
        },
      },
      managed: { ...managedConfiguration, brand: platformBrand },
    });
    expect(partial.identity).toMatchObject({
      assets: {
        logoDark: platformBrand.logoUrl,
        favicon: "https://assets.example.test/own-favicon.svg",
      },
    });

    const own = assembleEvidenceLibraryConfiguration({
      sections: ownerSections,
      managed: { ...managedConfiguration, brand: platformBrand },
    });
    expect(own.identity).toMatchObject({ assets: ownerSections.identity.assets });
  });

  test("refuses a missing logo when the platform brand is not set up", () => {
    const { assets: _assets, ...identityWithoutAssets } = ownerSections.identity;
    const input = {
      sections: { ...ownerSections, identity: identityWithoutAssets },
      managed: managedConfiguration,
    };
    expect(() => assembleEvidenceLibraryConfiguration(input)).toThrow(
      ConfigurationAssemblyError,
    );
    try {
      assembleEvidenceLibraryConfiguration(input);
    } catch (error) {
      expect((error as ConfigurationAssemblyError).issues).toEqual([
        expect.objectContaining({
          pointer: "/identity/assets/logoDark",
          section: "identity",
          keyword: "platformBrand",
        }),
        expect.objectContaining({
          pointer: "/identity/assets/favicon",
          section: "identity",
          keyword: "platformBrand",
        }),
      ]);
    }
  });

  test("refuses recipients when the platform mail service is not set up", () => {
    const withRecipients = {
      sections: { ...ownerSections, email: emailWithRecipients },
      managed: managedConfiguration,
    };
    expect(() => assembleEvidenceLibraryConfiguration(withRecipients)).toThrow(
      ConfigurationAssemblyError,
    );
    try {
      assembleEvidenceLibraryConfiguration(withRecipients);
    } catch (error) {
      expect((error as ConfigurationAssemblyError).issues).toEqual([
        expect.objectContaining({
          pointer: "/email/smtp/host",
          section: "email",
          keyword: "platformMail",
        }),
      ]);
    }
    // No recipients: the library deploys without a mail service.
    const withoutRecipients = assembleEvidenceLibraryConfiguration({
      sections: { ...ownerSections, email: {} },
      managed: managedConfiguration,
    });
    expect(withoutRecipients.email).toEqual({ smtp: { port: 587, security: "starttls" } });
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


describe("the platform embedding key", () => {
  test("prefers the embedding key, then the shared OpenRouter key", () => {
    expect(
      platformEmbeddingKey({
        EL_EMBEDDING_OPENROUTER_KEY: "sk-or-embed",
        OPENROUTER_API_KEY: "sk-or-shared",
      }),
    ).toBe("sk-or-embed");
    expect(
      platformEmbeddingKey({ OPENROUTER_API_KEY: "sk-or-shared" }),
    ).toBe("sk-or-shared");
    expect(
      platformEmbeddingKey({
        EL_EMBEDDING_OPENROUTER_KEY: "   ",
        OPENROUTER_API_KEY: "sk-or-shared",
      }),
    ).toBe("sk-or-shared");
    expect(platformEmbeddingKey({})).toBeUndefined();
    expect(
      platformEmbeddingKey({ EL_EMBEDDING_OPENROUTER_KEY: " sk-or-embed " }),
    ).toBe("sk-or-embed");
  });

  test("builds the REST block the runtime accepts", () => {
    expect(platformSearchEmbedder("sk-or-embed")).toEqual({
      source: "rest",
      url: "https://openrouter.ai/api/v1/embeddings",
      apiKey: "sk-or-embed",
      dimensions: 1024,
      request: {
        model: "perplexity/pplx-embed-v1-0.6b",
        input: ["{{text}}", "{{..}}"],
      },
      response: { data: [{ embedding: "{{embedding}}" }, "{{..}}"] },
    });
  });
});

describe("platform-owned fields an owner may not save", () => {
  test.each([
    ["aiSearch", { ai: true, aiSearch: true }, "/features/aiSearch"],
    ["deepResearch", { ai: true, deepResearch: true }, "/features/deepResearch"],
  ])("refuses a features row carrying %s", (_name, payload, pointer) => {
    const result = validateOwnerSection("features", payload);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ pointer, section: "features" }),
    );
    // The switches an owner does own still save.
    expect(validateOwnerSection("features", { ai: true }).valid).toBe(true);
  });

  test("refuses a search row carrying an embedder", () => {
    const result = validateOwnerSection("search", {
      embedder: {
        source: "rest",
        url: "https://openrouter.ai/api/v1/embeddings",
        request: { input: ["{{text}}"] },
        response: { data: [{ embedding: "{{embedding}}" }] },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ pointer: "/search/embedder", section: "search" }),
    );
    expect(validateOwnerSection("search", { fullText: true }).valid).toBe(true);
  });

  test.each(["largeModel", "smallModel"])(
    "refuses an AI provider entry carrying %s",
    (field) => {
      const result = validateOwnerSection(
        "ai",
        {
          providers: [
            {
              provider: AI_PROVIDER,
              enabled: true,
              models: [AI_MODELS[0]],
              defaultModel: AI_MODELS[0],
              [field]: AI_MODELS[0],
            },
          ],
        },
        { featuresAi: true },
      );
      expect(result.valid).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          pointer: `/ai/providers/0/${field}`,
          section: "ai",
        }),
      );
    },
  );
});
