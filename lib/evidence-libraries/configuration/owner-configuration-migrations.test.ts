import { describe, expect, it } from "vitest";
import { TEST_AI_MODELS } from "./test-models";
import {
  CURRENT_OWNER_CONFIGURATION_VERSION,
  completeOwnerConfigurationSnapshot,
  OwnerConfigurationMigrationError,
  migrateOwnerConfiguration,
  OWNER_CONFIGURATION_MIGRATIONS,
  validateOwnerConfigurationMigrationRegistry,
  type OwnerConfigurationMigration,
  type OwnerConfigurationMigrationSnapshot,
  type OwnerConfigurationSnapshot,
} from "./owner-configuration-migrations";

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
      ],
    });
    expect(result.changedPointers).toEqual([
      "/ownerConfigurationVersion",
      "/features/aiSearch",
      "/features/deepResearch",
      "/exports",
      "/ai",
      "/ai/providers/0/models",
    ]);
    expect(legacySnapshot.sections[0]?.payload).toEqual({
      ai: false,
      aiSearch: "legacy",
      deepResearch: false,
    });
  });

  it("adds an Identity assets container without changing its other values", () => {
    const identity = {
      name: "Climate",
      shortName: "Climate",
      baseUrl: "https://climate.example.test",
      tagline: "Evidence for climate decisions",
      description: "A library for climate research.",
      fundingPartners: [{ id: "partner", name: "Partner" }],
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
    ]);
    expect(missingAssets.changedPointers).toEqual([
      "/ownerConfigurationVersion",
      "/identity/assets",
      "/ai",
      "/ai/providers/0/models",
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
          payload: { years: { enabled: true } },
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
      ],
    });
    expect(result.changedPointers).toEqual([
      "/ownerConfigurationVersion",
      "/search/authorCountry",
      "/filters/countryLibrary",
      "/features/authorLocation",
      "/ai",
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
