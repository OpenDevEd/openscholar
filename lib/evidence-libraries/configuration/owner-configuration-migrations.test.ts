import { describe, expect, it } from "vitest";
import { TEST_AI_MODELS } from "./test-models";
import {
  completeOwnerConfigurationSnapshot,
  OwnerConfigurationMigrationError,
  migrateOwnerConfiguration,
  OWNER_CONFIGURATION_MIGRATIONS,
  validateOwnerConfigurationMigrationRegistry,
  type OwnerConfigurationMigration,
  type OwnerConfigurationMigrationSnapshot,
  type OwnerConfigurationSnapshot,
} from "./owner-configuration-migrations";
import { CURRENT_OWNER_CONFIGURATION_VERSION } from "./owner-configuration-version";

const legacySnapshot: OwnerConfigurationSnapshot = {
  ownerConfigurationVersion: 1,
  sections: [
    {
      sectionKey: "features",
      payload: { ai: false, aiSearch: "legacy", deepResearch: false },
    },
    {
      sectionKey: "exports",
      payload: {
        ris: "https://feeds.example.test/library.ris",
        bibtex: true,
        atom: false,
      },
    },
  ],
};

const TOPICS_DEFAULT = {
  sectionKey: "topics" as const,
  payload: { enabled: false },
};

function expectMigrationError(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(OwnerConfigurationMigrationError);
    return error as OwnerConfigurationMigrationError;
  }
  throw new Error("Expected migration to fail");
}

function withMigrations<T>(
  migrations: readonly OwnerConfigurationMigration[],
  run: (migrations: readonly OwnerConfigurationMigration[]) => T,
): T {
  return run(migrations);
}

describe("owner configuration migrations", () => {
  it("moves version 1 to the current version and preserves the owner values", () => {
    const result = migrateOwnerConfiguration(legacySnapshot);

    expect(result.snapshot).toEqual({
      ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
      sections: [
        { sectionKey: "features", payload: { ai: false } },
        {
          sectionKey: "exports",
          payload: { ris: true, bibtex: true, atom: false },
        },
        {
          sectionKey: "ai",
          payload: {
            providers: [{ provider: "openrouter", enabled: false, models: [] }],
          },
        },
        TOPICS_DEFAULT,
      ],
    });
    expect(result.changedPointers).toEqual([
      "/ownerConfigurationVersion",
      "/features/aiSearch",
      "/features/deepResearch",
      "/exports",
      "/ai",
      "/ai/providers/0/models",
      "/topics",
    ]);
    expect(legacySnapshot.sections[0]?.payload).toEqual({
      ai: false,
      aiSearch: "legacy",
      deepResearch: false,
    });
  });

  it("gives each saved Zotero group its PDF setting, keeping the PDFs it adds today", () => {
    const zotero = (groupId: string) => ({
      key: `zotero-${groupId}`,
      provider: "zotero",
      groupId,
      enabled: true,
      writebackEnabled: false,
    });
    const result = migrateOwnerConfiguration({
      ownerConfigurationVersion: 6,
      sections: [
        {
          sectionKey: "sources",
          payload: [zotero("42"), { ...zotero("77"), settings: { downloadPdfs: false } }],
        },
      ],
    });
    expect(result.snapshot.ownerConfigurationVersion).toBe(CURRENT_OWNER_CONFIGURATION_VERSION);
    const off = { enabled: false, subject: "", keptOut: ["not-about"] };
    const pdfPublishing = { mode: "tagged", tags: ["_publish", "publishPDF"] };
    expect(result.snapshot.sections.find((row) => row.sectionKey === "sources")?.payload).toEqual([
      { ...zotero("42"), settings: { downloadPdfs: true, pdfPublishing }, screening: off },
      { ...zotero("77"), settings: { downloadPdfs: false, pdfPublishing }, screening: off },
    ]);
  });

  it("turns the old login and personal collections switches into reader accounts", () => {
    const features = (payload: Record<string, unknown>) =>
      migrateOwnerConfiguration({
        ownerConfigurationVersion: 7,
        sections: [{ sectionKey: "features", payload: { collections: true, ...payload } }],
      }).snapshot.sections.find((row) => row.sectionKey === "features")?.payload;

    expect(features({ login: false, userCollections: true })).toEqual({ collections: true, readerAccounts: true });
    expect(features({ login: true, userCollections: false })).toEqual({ collections: true, readerAccounts: true });
    expect(features({ login: false, userCollections: false })).toEqual({ collections: true });
    expect(features({})).toEqual({ collections: true });
    // A value that is not a yes or no cannot be read as either.
    expect(() => features({ login: "true" })).toThrow();
    expect(() => features({ userCollections: null })).toThrow();
  });

  it("gives a saved content row the open-access label readers already see", () => {
    const { snapshot } = migrateOwnerConfiguration({
      ownerConfigurationVersion: 8,
      sections: [{ sectionKey: "content", payload: { tags: { hidden: ["hide"] } } }],
    });
    expect(snapshot.sections.find((row) => row.sectionKey === "content")?.payload).toEqual({
      openAccessLabel: "open",
      tags: { hidden: ["hide"] },
    });
  });

  it("gives each saved source screening off, as the library reads one saved before screening, and keeps one already set", () => {
    const screened = { enabled: true, subject: "Climate adaptation", keptOut: ["not-about", "passing"] };
    const { snapshot } = migrateOwnerConfiguration({
      ownerConfigurationVersion: 9,
      sections: [{
        sectionKey: "sources",
        payload: [
          { key: "zotero-42", provider: "zotero", groupId: "42", enabled: true, writebackEnabled: false, settings: { downloadPdfs: true } },
          { key: "zotero-77", provider: "zotero", groupId: "77", enabled: true, writebackEnabled: false, settings: { downloadPdfs: true }, screening: screened },
        ],
      }],
    });
    const sources = snapshot.sections.find((row) => row.sectionKey === "sources")?.payload as { screening: unknown }[];
    expect(sources.map((source) => source.screening)).toEqual([{ enabled: false, subject: "", keptOut: ["not-about"] }, screened]);
  });

  it("gives each saved Zotero group the library's publish tags as its own, and keeps a rule already set", () => {
    const every = { mode: "every", tags: [] };
    const zotero = (groupId: string, settings: Record<string, unknown>) =>
      ({ key: `zotero-${groupId}`, provider: "zotero", groupId, enabled: true, writebackEnabled: false, settings });
    const { snapshot } = migrateOwnerConfiguration({
      ownerConfigurationVersion: 10,
      sections: [
        { sectionKey: "content", payload: { tags: { publish: ["approved"] }, openAccessLabel: "open" } },
        { sectionKey: "sources", payload: [zotero("42", { downloadPdfs: true }), zotero("77", { downloadPdfs: true, pdfPublishing: every })] },
      ],
    });
    const sources = snapshot.sections.find((row) => row.sectionKey === "sources")?.payload as { settings: unknown }[];
    expect(sources.map((source) => source.settings)).toEqual([
      { downloadPdfs: true, pdfPublishing: { mode: "tagged", tags: ["approved"] } },
      { downloadPdfs: true, pdfPublishing: every },
    ]);
    // The library's own tags stay, for the records it makes itself.
    expect(snapshot.sections.find((row) => row.sectionKey === "content")?.payload).toMatchObject({ tags: { publish: ["approved"] } });
  });

  it("leaves out of each Zotero group's publish tags the ones that are also hide or internal tags", () => {
    const { snapshot } = migrateOwnerConfiguration({
      ownerConfigurationVersion: 10,
      sections: [
        { sectionKey: "content", payload: { tags: { publish: ["approved", "Hide"], hidden: ["hide"] }, openAccessLabel: "open" } },
        { sectionKey: "sources", payload: [{ key: "zotero-42", provider: "zotero", groupId: "42", enabled: true, writebackEnabled: false, settings: { downloadPdfs: true } }] },
      ],
    });
    const [source] = snapshot.sections.find((row) => row.sectionKey === "sources")?.payload as { settings: unknown }[];
    expect(source!.settings).toEqual({ downloadPdfs: true, pdfPublishing: { mode: "tagged", tags: ["approved"] } });
  });

  it("moves a community's saved partners into its funders, once each, and keeps every funder as it was", () => {
    const IDENTITY = { name: "Climate", shortName: "Climate", baseUrl: "https://climate.example.test", assets: {} };
    const funders = [{ id: "fp", name: "Jacobs Foundation", href: "https://jacobsfoundation.org", logoUrl: "https://assets.example.test/jacobs.svg" }];
    const migrate = (identity: Record<string, unknown>, footer?: Record<string, unknown>) => {
      const { snapshot } = migrateOwnerConfiguration({
        ownerConfigurationVersion: 14,
        sections: [{ sectionKey: "identity", payload: { ...IDENTITY, ...identity } }, ...(footer ? [{ sectionKey: "footer", payload: footer }] : [])],
      });
      const payload = (key: string) => snapshot.sections.find((row) => row.sectionKey === key)?.payload as Record<string, unknown> | undefined;
      return { identity: payload("identity"), footer: payload("footer") };
    };
    // One a funder already names is that funder. One whose id a funder has gets a free id. One left without a name is
    // dropped. The rest follow in order.
    const both = migrate(
      { fundingPartners: [{ id: "a", name: " jacobs foundation " }, { id: "fp", name: "FCDO" }, { id: "blank", name: " " }, { id: "b", name: "World Bank" }] },
      { disclaimer: "As is.", funders },
    );
    expect(both.identity).toEqual(IDENTITY);
    expect(both.footer).toEqual({ disclaimer: "As is.", funders: [...funders, { id: "partner-1", name: "FCDO" }, { id: "b", name: "World Bank" }] });
    // Partners with no footer saved yet make one. No partners leaves the footer alone.
    expect(migrate({ fundingPartners: [{ id: "a", name: "FCDO" }] }).footer).toEqual({ funders: [{ id: "a", name: "FCDO" }] });
    expect(migrate({ fundingPartners: [] }, { funders })).toEqual({ identity: IDENTITY, footer: { funders } });
    expect(migrate({}, { funders }).footer).toEqual({ funders });
    // Partners that can't be read are never dropped: the snapshot is refused with them still in it.
    for (const unreadable of [["FCDO"], { id: "a", name: "FCDO" }, [{ id: "a" }]]) expect(() => migrate({ fundingPartners: unreadable })).toThrow(OwnerConfigurationMigrationError);
  });

  it("gives a saved tag filter named after a search option a free address name, and drops its * tags, so it still loads", () => {
    const { snapshot } = migrateOwnerConfiguration({
      ownerConfigurationVersion: 13,
      sections: [
        {
          sectionKey: "filters",
          payload: {
            tagFilters: [
              { id: "type", label: "Type", options: [{ value: "*" }, { value: "Reviewed" }], defaults: ["*", "Reviewed"] },
              { id: "filter-1", label: "状态" },
              { id: "status", label: "Status" },
            ],
          },
        },
      ],
    });
    const filters = snapshot.sections.find((row) => row.sectionKey === "filters")?.payload as { tagFilters: unknown[] };
    expect(filters.tagFilters).toEqual([
      { id: "filter-2", label: "Type", options: [{ value: "Reviewed" }], defaults: ["Reviewed"] },
      { id: "filter-1", label: "状态" },
      { id: "status", label: "Status" },
    ]);
  });

  it("gives a saved filters row no tag filters, collections matching all and the study types filter, keeping ones already set", () => {
    const filters = (payload: Record<string, unknown>) =>
      migrateOwnerConfiguration({ ownerConfigurationVersion: 12, sections: [{ sectionKey: "filters", payload }] })
        .snapshot.sections.find((row) => row.sectionKey === "filters")?.payload;
    expect(filters({ sources: { enabled: true, label: "sources" } })).toMatchObject({
      sources: { enabled: true, label: "sources" },
      tagFilters: [],
      collectionsMatch: { default: "all", readerSwitch: false },
      studyTypes: { enabled: true },
    });
    expect(filters({ studyTypes: { enabled: false } })).toMatchObject({ studyTypes: { enabled: false } });
  });

  it("gives a saved filters row the sources filter readers get today, and keeps one already set", () => {
    const filters = (payload: Record<string, unknown>) =>
      migrateOwnerConfiguration({ ownerConfigurationVersion: 11, sections: [{ sectionKey: "filters", payload }] })
        .snapshot.sections.find((row) => row.sectionKey === "filters")?.payload;
    expect(filters({ institution: { mode: "facet", label: "Partners" } })).toMatchObject({
      institution: { mode: "facet", label: "Partners" },
      sources: { enabled: true, label: "sources" },
    });
    expect(filters({ sources: { enabled: false, label: "Searches" } })).toMatchObject({ sources: { enabled: false, label: "Searches" } });
  });

  it("adds an Identity assets container without changing its other values", () => {
    const identity = {
      name: "Climate",
      shortName: "Climate",
      baseUrl: "https://climate.example.test",
      tagline: "Evidence for climate decisions",
      description: "A library for climate research.",
    };
    const missingAssets = migrateOwnerConfiguration({
      ownerConfigurationVersion: 1,
      sections: [{ sectionKey: "identity", payload: identity }],
    });

    expect(missingAssets.snapshot.sections).toEqual([
      {
        sectionKey: "identity",
        payload: { ...identity, assets: {} },
      },
      {
        sectionKey: "ai",
        payload: {
          providers: [{ provider: "openrouter", enabled: false, models: [] }],
        },
      },
      TOPICS_DEFAULT,
    ]);
    expect(missingAssets.changedPointers).toEqual([
      "/ownerConfigurationVersion",
      "/identity/assets",
      "/ai",
      "/ai/providers/0/models",
      "/topics",
    ]);

    const existingAssets = {
      ...identity,
      assets: {
        logoDark: "https://assets.example.test/logo-dark.svg",
        favicon: "https://assets.example.test/favicon.svg",
      },
    };
    expect(
      migrateOwnerConfiguration({
        ownerConfigurationVersion: 1,
        sections: [{ sectionKey: "identity", payload: existingAssets }],
      }).snapshot.sections,
    ).toEqual([
      { sectionKey: "identity", payload: existingAssets },
      {
        sectionKey: "ai",
        payload: {
          providers: [{ provider: "openrouter", enabled: false, models: [] }],
        },
      },
      TOPICS_DEFAULT,
    ]);

    const invalidAssets = expectMigrationError(() =>
      migrateOwnerConfiguration({
        ownerConfigurationVersion: 1,
        sections: [
          {
            sectionKey: "identity",
            payload: { ...identity, assets: "not-an-object" },
          },
        ],
      }),
    );
    expect(invalidAssets.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pointer: "/identity/assets",
          keyword: "type",
        }),
      ]),
    );

    const { name: _name, ...withoutName } = identity;
    const missingName = expectMigrationError(() =>
      migrateOwnerConfiguration({
        ownerConfigurationVersion: 1,
        sections: [{ sectionKey: "identity", payload: withoutName }],
      }),
    );
    expect(missingName.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pointer: "/identity/name",
          keyword: "required",
        }),
      ]),
    );
  });

  it.each([
    {weekly: {weekday: 5, time: "16:30", timezone: "Asia/Kolkata"}, expected: {weekday: 5, time: "16:30", timezone: "Asia/Kolkata"}},
    {weekly: {}, expected: {weekday: 1, time: "09:00", timezone: "UTC"}},
    {weekly: {time: "16:30"}, expected: {weekday: 1, time: "16:30", timezone: "UTC"}},
  ])("preserves saved weekly fields and their defaults when adding monthly support: $weekly", ({weekly, expected}) => {
    const original = {ownerConfigurationVersion: 4, sections: [{sectionKey: "notifications", payload: {enabled: true, weekly}}]};
    const before = structuredClone(original);
    const result = migrateOwnerConfiguration(original);
    expect(result.snapshot.sections.find(row => row.sectionKey === "notifications")?.payload).toEqual({enabled: true, schedule: {frequency: "weekly", ...expected}});
    expect(original).toEqual(before);
  });

  it("removes the temporary author-location settings from version 3", () => {
    const result = migrateOwnerConfiguration({
      ownerConfigurationVersion: 3,
      sections: [
        {
          sectionKey: "search",
          payload: { fullText: true, country: true, authorCountry: false },
        },
        {
          sectionKey: "filters",
          payload: { countryLibrary: true, years: { enabled: true } },
        },
        {
          sectionKey: "features",
          payload: { authorFilter: true, authorLocation: true },
        },
      ],
    });

    expect(result.snapshot).toEqual({
      ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
      sections: [
        {
          sectionKey: "search",
          payload: { fullText: true, country: true },
        },
        {
          sectionKey: "filters",
          payload: {
            tagFilters: [],
            collectionsMatch: { default: "all", readerSwitch: false },
            studyTypes: { enabled: true },
            sources: { enabled: true, label: "sources" },
            years: { enabled: true },
          },
        },
        {
          sectionKey: "features",
          payload: { authorFilter: true },
        },
        {
          sectionKey: "ai",
          payload: {
            providers: [{ provider: "openrouter", enabled: false, models: [] }],
          },
        },
        TOPICS_DEFAULT,
      ],
    });
    expect(result.changedPointers).toEqual([
      "/ownerConfigurationVersion",
      "/search/authorCountry",
      "/filters/countryLibrary",
      "/features/authorLocation",
      "/ai",
      "/topics",
      "/filters/sources",
      "/filters/tagFilters",
      "/filters/collectionsMatch",
      "/filters/studyTypes",
    ]);
  });

  it("completes declared default rows without overwriting explicit values", () => {
    const currentMigration = OWNER_CONFIGURATION_MIGRATIONS.find(
      ({ to }) => to === CURRENT_OWNER_CONFIGURATION_VERSION,
    );
    if (!currentMigration) throw new Error("Missing current migration");
    const customMigrations = OWNER_CONFIGURATION_MIGRATIONS.map((migration) =>
      migration === currentMigration
        ? {
            ...migration,
            defaultRows: [
              ...(migration.defaultRows ?? []),
              { sectionKey: "analytics" as const, payload: () => ({}) },
            ],
          }
        : migration,
    );
    const missing = completeOwnerConfigurationSnapshot(
      {
        ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
        sections: [{ sectionKey: "features", payload: { ai: false } }],
      },
      customMigrations,
    );
    expect(missing.sections).toEqual([
      { sectionKey: "features", payload: { ai: false } },
      {
        sectionKey: "ai",
        payload: {
          providers: [{ provider: "openrouter", enabled: false, models: [] }],
        },
      },
      TOPICS_DEFAULT,
      { sectionKey: "analytics", payload: {} },
    ]);
    expect(
      completeOwnerConfigurationSnapshot(missing, customMigrations),
    ).toEqual(missing);

    const explicit = {
      sectionKey: "ai" as const,
      payload: {
        providers: [{ provider: "openrouter", enabled: false, models: [] }],
      },
    };
    const changed = completeOwnerConfigurationSnapshot(
      {
        ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
        sections: [explicit],
      },
      customMigrations,
    );
    expect(changed.sections).toContainEqual(explicit);
    expect(changed.sections).toContainEqual({
      sectionKey: "analytics",
      payload: {},
    });
  });

  it("does not mutate input and returns deterministic results", () => {
    const input = structuredClone(legacySnapshot);
    const first = migrateOwnerConfiguration(input);
    const second = migrateOwnerConfiguration(input);

    expect(input).toEqual(legacySnapshot);
    expect(first).toEqual(second);
    expect(first.snapshot).not.toBe(input);
  });

  it("has an explicit consecutive registry and leaves current snapshots alone", () => {
    expect(
      OWNER_CONFIGURATION_MIGRATIONS.map(({ from, to }) => [from, to]),
    ).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 8],
      [8, 9],
      [9, 10],
      [10, 11],
      [11, 12],
      [12, 13],
      [13, 14],
      [14, 15],
    ]);
    expect(
      validateOwnerConfigurationMigrationRegistry(
        OWNER_CONFIGURATION_MIGRATIONS,
        CURRENT_OWNER_CONFIGURATION_VERSION,
      ),
    ).toEqual([]);
    const current: OwnerConfigurationSnapshot = {
      ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
      sections: [{ sectionKey: "features", payload: { ai: false } }],
    };

    expect(migrateOwnerConfiguration(current)).toEqual({
      snapshot: current,
      changedPointers: [],
    });
  });

  it("preserves configured model choices and order without a baked-in catalog", () => {
    const result = migrateOwnerConfiguration({
      ownerConfigurationVersion: 2,
      sections: [
        {
          sectionKey: "ai",
          payload: {
            providers: [
              {
                provider: "openrouter",
                enabled: true,
                models: [
                  "anthropic/claude-sonnet-5",
                  TEST_AI_MODELS[2],
                  TEST_AI_MODELS[2],
                ],
                defaultModel: "anthropic/claude-sonnet-5",
              },
            ],
          },
        },
      ],
    });

    expect(result.snapshot.sections).toEqual([
      {
        sectionKey: "ai",
        payload: {
          providers: [
            {
              provider: "openrouter",
              enabled: true,
              models: ["anthropic/claude-sonnet-5", TEST_AI_MODELS[2]],
              defaultModel: "anthropic/claude-sonnet-5",
            },
          ],
        },
      },
      TOPICS_DEFAULT,
    ]);
  });

  it("migrates a version 2 default into the selected model list", () => {
    const result = migrateOwnerConfiguration({
      ownerConfigurationVersion: 2,
      sections: [
        {
          sectionKey: "ai",
          payload: {
            providers: [
              {
                provider: "openrouter",
                enabled: true,
                defaultModel: TEST_AI_MODELS[1],
              },
            ],
          },
        },
      ],
    });

    expect(result.snapshot.sections[0]).toEqual({
      sectionKey: "ai",
      payload: {
        providers: [
          {
            provider: "openrouter",
            enabled: true,
            models: [TEST_AI_MODELS[1]],
            defaultModel: TEST_AI_MODELS[1],
          },
        ],
      },
    });
  });

  it("switches AI off when no model was selected", () => {
    const result = migrateOwnerConfiguration({
      ownerConfigurationVersion: 2,
      sections: [
        { sectionKey: "features", payload: { ai: true } },
        {
          sectionKey: "ai",
          payload: {
            providers: [
              {
                provider: "openrouter",
                enabled: true,
              },
            ],
          },
        },
      ],
    });

    expect(result.snapshot.sections).toEqual([
      { sectionKey: "features", payload: { ai: false } },
      {
        sectionKey: "ai",
        payload: {
          providers: [{ provider: "openrouter", enabled: false, models: [] }],
        },
      },
      TOPICS_DEFAULT,
    ]);
  });

  it("clears obsolete AI fields when a version 2 provider is disabled", () => {
    const result = migrateOwnerConfiguration({
      ownerConfigurationVersion: 2,
      sections: [
        {
          sectionKey: "ai",
          payload: {
            providers: [
              {
                provider: "openrouter",
                enabled: false,
                models: [TEST_AI_MODELS[0]],
                defaultModel: TEST_AI_MODELS[0],
              },
            ],
          },
        },
      ],
    });

    expect(result.snapshot.sections[0]).toEqual({
      sectionKey: "ai",
      payload: {
        providers: [{ provider: "openrouter", enabled: false, models: [] }],
      },
    });
  });

  it("validates unique consecutive chains without changing the production registry", () => {
    const chained: OwnerConfigurationMigration[] = [
      {
        from: 1,
        to: 2,
        migrate: (snapshot) => ({
          ownerConfigurationVersion: 2,
          sections: [{ sectionKey: "legacy", payload: { enabled: "on" } }],
        }),
      },
      {
        from: 2,
        to: 3,
        migrate: (snapshot) => ({
          ownerConfigurationVersion: 3,
          sections: [{ sectionKey: "features", payload: { ai: false } }],
        }),
      },
    ];
    expect(validateOwnerConfigurationMigrationRegistry(chained, 3)).toEqual([]);
    expect(
      validateOwnerConfigurationMigrationRegistry(
        [chained[1]!, chained[0]!],
        3,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "outOfOrderMigration" }),
      ]),
    );
    expect(
      migrateOwnerConfiguration(
        {
          ownerConfigurationVersion: 1,
          sections: [{ sectionKey: "legacy", payload: "on" }],
        },
        {},
        chained,
        3,
      ).snapshot,
    ).toEqual({
      ownerConfigurationVersion: 3,
      sections: [{ sectionKey: "features", payload: { ai: false } }],
    });
    expect(
      validateOwnerConfigurationMigrationRegistry(
        [
          ...chained,
          {
            from: 2,
            to: 3,
            migrate: (snapshot) => ({
              ...snapshot,
              ownerConfigurationVersion: 3,
            }),
          },
        ],
        3,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "duplicateMigration" }),
      ]),
    );
    expect(
      validateOwnerConfigurationMigrationRegistry(
        [{ ...chained[0]!, from: 1, to: 3 }],
        3,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "nonConsecutiveMigration" }),
        expect.objectContaining({ keyword: "missingMigration" }),
      ]),
    );
    expect(
      OWNER_CONFIGURATION_MIGRATIONS.map(({ from, to }) => [from, to]),
    ).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 8],
      [8, 9],
      [9, 10],
      [10, 11],
      [11, 12],
      [12, 13],
      [13, 14],
      [14, 15],
    ]);
  });

  it("lets a historical step remove, rename, convert, transfer, split, merge, and remove sections", () => {
    const migrations: OwnerConfigurationMigration[] = [
      {
        from: 1,
        to: 2,
        migrate: (snapshot) => {
          const legacy = new Map(
            snapshot.sections.map((row) => [row.sectionKey, row.payload]),
          );
          const features = legacy.get("legacyFeatures") as {
            enabled: string;
          };
          const exports = legacy.get("legacyExports") as {
            ris: string;
            bibtex: boolean;
            atom: boolean;
          };
          const contact = legacy.get("legacyContact") as {
            email: string;
          };
          const identity = legacy.get("legacyIdentity") as {
            first: string;
            last: string;
            baseUrl: string;
          };
          return {
            ownerConfigurationVersion: 2,
            sections: [
              {
                sectionKey: "features",
                payload: { ai: features.enabled === "on" },
              },
              {
                sectionKey: "exports",
                payload: {
                  ris: exports.ris === "on",
                  bibtex: exports.bibtex,
                  atom: exports.atom,
                },
              },
              {
                sectionKey: "identity",
                payload: {
                  name: `${identity.first} ${identity.last}`,
                  baseUrl: identity.baseUrl,
                },
              },
              { sectionKey: "contact", payload: { email: contact.email } },
              {
                sectionKey: "email",
                payload: { contactRecipient: contact.email },
              },
            ],
          };
        },
      },
    ];
    const source: OwnerConfigurationMigrationSnapshot = {
      ownerConfigurationVersion: 1,
      sections: [
        {
          sectionKey: "legacyFeatures",
          payload: {
            enabled: "on",
            removed: "discard-me",
            platformOwned: true,
          },
        },
        {
          sectionKey: "legacyExports",
          payload: { ris: "on", bibtex: false, atom: true },
        },
        {
          sectionKey: "legacyIdentity",
          payload: {
            first: "Climate",
            last: "Evidence",
            baseUrl: "https://climate.example.test",
          },
        },
        {
          sectionKey: "legacyContact",
          payload: { email: "owner@example.test" },
        },
        { sectionKey: "legacy/obsolete", payload: { old: "value" } },
      ],
    };

    const result = migrateOwnerConfiguration(source, {}, migrations, 2);
    expect(result.snapshot).toEqual({
      ownerConfigurationVersion: 2,
      sections: [
        { sectionKey: "features", payload: { ai: true } },
        {
          sectionKey: "exports",
          payload: { ris: true, bibtex: false, atom: true },
        },
        {
          sectionKey: "identity",
          payload: {
            name: "Climate Evidence",
            baseUrl: "https://climate.example.test",
          },
        },
        { sectionKey: "contact", payload: { email: "owner@example.test" } },
        {
          sectionKey: "email",
          payload: { contactRecipient: "owner@example.test" },
        },
      ],
    });
    expect(result.changedPointers).toContain("/legacy~1obsolete");
  });

  it("reports an explicit failure when a historical value cannot be interpreted", () => {
    const error = expectMigrationError(() =>
      migrateOwnerConfiguration(
        {
          ownerConfigurationVersion: 1,
          sections: [{ sectionKey: "legacyFeatures", payload: { enabled: 1 } }],
        },
        {},
        [
          {
            from: 1,
            to: 2,
            migrate: (snapshot) => {
              const payload = snapshot.sections[0]?.payload;
              if (
                !payload ||
                typeof payload !== "object" ||
                Array.isArray(payload) ||
                typeof (payload as Record<string, unknown>).enabled !== "string"
              ) {
                throw new Error("Legacy feature value is ambiguous");
              }
              return {
                ownerConfigurationVersion: 2,
                sections: [{ sectionKey: "features", payload: { ai: false } }],
              };
            },
          },
        ],
        2,
      ),
    );
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "migrationFailed" }),
      ]),
    );
  });

  it("keeps owner sources key-free until runtime assembly", () => {
    const snapshot: OwnerConfigurationSnapshot = {
      ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
      sections: [
        {
          sectionKey: "sources",
          payload: [
            {
              key: "zotero-77",
              provider: "zotero",
              groupId: "77",
              enabled: true,
              writebackEnabled: false,
              settings: {},
            },
          ],
        },
      ],
    };

    expect(migrateOwnerConfiguration(snapshot)).toEqual({
      snapshot,
      changedPointers: [],
    });
  });

  it("moves complete snapshots and rejects collisions from a migration step", () => {
    const moved = withMigrations(
      [
        {
          from: 1,
          to: 2,
          migrate: (snapshot) => ({
            ...snapshot,
            ownerConfigurationVersion: 2,
            sections: snapshot.sections.map((row) =>
              row.sectionKey === "features"
                ? { ...row, sectionKey: "exports" }
                : row,
            ),
          }),
        },
      ],
      (migrations) =>
        migrateOwnerConfiguration(
          {
            ownerConfigurationVersion: 1,
            sections: [{ sectionKey: "features", payload: {} }],
          },
          {},
          migrations,
          2,
        ),
    );
    expect(moved.snapshot).toEqual({
      ownerConfigurationVersion: 2,
      sections: [{ sectionKey: "exports", payload: {} }],
    });

    const collision = expectMigrationError(() =>
      withMigrations(
        [
          {
            from: 1,
            to: 2,
            migrate: (snapshot) => ({
              ...snapshot,
              ownerConfigurationVersion: 2,
              sections: [
                ...snapshot.sections,
                { sectionKey: "exports", payload: {} },
              ],
            }),
          },
        ],
        (migrations) =>
          migrateOwnerConfiguration(
            {
              ownerConfigurationVersion: 1,
              sections: [{ sectionKey: "exports", payload: {} }],
            },
            {},
            migrations,
            2,
          ),
      ),
    );
    expect(collision.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "duplicate" }),
      ]),
    );
  });

  it("rejects duplicate, unknown, and credential-bearing rows", () => {
    const duplicate = expectMigrationError(() =>
      migrateOwnerConfiguration({
        ownerConfigurationVersion: 1,
        sections: [
          { sectionKey: "features", payload: {} },
          { sectionKey: "features", payload: {} },
        ],
      }),
    );
    expect(duplicate.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "duplicate" }),
      ]),
    );

    const unknown = expectMigrationError(() =>
      migrateOwnerConfiguration({
        ownerConfigurationVersion: 1,
        sections: [{ sectionKey: "future", payload: {} } as never],
      }),
    );
    expect(unknown.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "unknownSection" }),
      ]),
    );

    const credential = expectMigrationError(() =>
      migrateOwnerConfiguration({
        ownerConfigurationVersion: 2,
        sections: [
          {
            sectionKey: "identity",
            payload: {
              name: "Climate",
              baseUrl: "https://climate.example.test",
              assets: {
                logoDark: "https://assets.example.test/logo.svg",
                favicon: "https://assets.example.test/favicon.svg",
              },
            },
          },
          {
            sectionKey: "services",
            payload: { database: { url: "postgres://secret" } },
          },
        ],
      }),
    );
    expect(credential.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "credentialMaterial" }),
      ]),
    );

    const invalidOutput = expectMigrationError(() =>
      withMigrations(
        [
          {
            from: 1,
            to: 2,
            migrate: (snapshot) => ({
              ...snapshot,
              ownerConfigurationVersion: 2,
              sections: [{ sectionKey: "features", payload: { ai: "on" } }],
            }),
          },
        ],
        (migrations) =>
          migrateOwnerConfiguration(
            {
              ownerConfigurationVersion: 1,
              sections: [{ sectionKey: "features", payload: {} }],
            },
            {},
            migrations,
            2,
          ),
      ),
    );
    expect(invalidOutput.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: "type" })]),
    );

    const credentialOutput = expectMigrationError(() =>
      withMigrations(
        [
          {
            from: 1,
            to: 2,
            migrate: (snapshot) => ({
              ...snapshot,
              ownerConfigurationVersion: 2,
              sections: [
                {
                  sectionKey: "email",
                  payload: { smtp: { password: "secret" } },
                },
              ],
            }),
          },
        ],
        (migrations) =>
          migrateOwnerConfiguration(
            {
              ownerConfigurationVersion: 1,
              sections: [{ sectionKey: "email", payload: {} }],
            },
            {},
            migrations,
            2,
          ),
      ),
    );
    expect(credentialOutput.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "credentialMaterial" }),
      ]),
    );
  });

  it("rejects missing, unknown, newer, and gapped versions", () => {
    for (const version of [undefined, 0, CURRENT_OWNER_CONFIGURATION_VERSION + 1]) {
      const error = expectMigrationError(() =>
        migrateOwnerConfiguration({
          ownerConfigurationVersion: version as never,
          sections: [],
        }),
      );
      expect(error.issues[0]?.keyword).toMatch(/version/i);
    }

    const error = expectMigrationError(() =>
      withMigrations(
        [
          {
            from: 1,
            to: 3,
            migrate: (snapshot) => ({
              ...snapshot,
              ownerConfigurationVersion: 3,
            }),
          },
        ],
        (migrations) =>
          migrateOwnerConfiguration(
            {
              ownerConfigurationVersion: 1,
              sections: [],
            },
            {},
            migrations,
          ),
      ),
    );
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "nonConsecutiveMigration" }),
        expect.objectContaining({ keyword: "missingMigration" }),
      ]),
    );
  });
});
