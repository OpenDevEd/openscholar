import { describe, expect, it } from "vitest";
import {
  CURRENT_OWNER_CONFIGURATION_VERSION,
  OwnerConfigurationMigrationError,
  migrateOwnerConfiguration,
  OWNER_CONFIGURATION_MIGRATIONS,
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
  migrations: typeof OWNER_CONFIGURATION_MIGRATIONS,
  run: () => T,
): T {
  const original = [...OWNER_CONFIGURATION_MIGRATIONS];
  OWNER_CONFIGURATION_MIGRATIONS.splice(
    0,
    OWNER_CONFIGURATION_MIGRATIONS.length,
    ...migrations,
  );
  try {
    return run();
  } finally {
    OWNER_CONFIGURATION_MIGRATIONS.splice(
      0,
      OWNER_CONFIGURATION_MIGRATIONS.length,
      ...original,
    );
  }
}

describe("owner configuration migrations", () => {
  it("moves version 1 to version 2 and preserves the owner values", () => {
    const result = migrateOwnerConfiguration(legacySnapshot);

    expect(result.snapshot).toEqual({
      ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
      sections: [
        { sectionKey: "features", payload: { ai: false } },
        {
          sectionKey: "exports",
          payload: { ris: true, bibtex: true, atom: false },
        },
      ],
    });
    expect(result.changedPointers).toEqual([
      "/ownerConfigurationVersion",
      "/features/aiSearch",
      "/features/deepResearch",
      "/exports",
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
    ]);
    expect(missingAssets.changedPointers).toEqual([
      "/ownerConfigurationVersion",
      "/identity/assets",
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
    ).toEqual([{ sectionKey: "identity", payload: existingAssets }]);

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
    ).toEqual([[1, 2]]);
    const current: OwnerConfigurationSnapshot = {
      ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
      sections: [{ sectionKey: "features", payload: { ai: false } }],
    };

    expect(migrateOwnerConfiguration(current)).toEqual({
      snapshot: current,
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
      () =>
        migrateOwnerConfiguration({
          ownerConfigurationVersion: 1,
          sections: [{ sectionKey: "features", payload: {} }],
        }),
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
        () =>
          migrateOwnerConfiguration({
            ownerConfigurationVersion: 1,
            sections: [{ sectionKey: "exports", payload: {} }],
          }),
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
        () =>
          migrateOwnerConfiguration({
            ownerConfigurationVersion: 1,
            sections: [{ sectionKey: "features", payload: {} }],
          }),
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
        () =>
          migrateOwnerConfiguration({
            ownerConfigurationVersion: 1,
            sections: [{ sectionKey: "email", payload: {} }],
          }),
      ),
    );
    expect(credentialOutput.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "credentialMaterial" }),
      ]),
    );
  });

  it("rejects missing, unknown, newer, and gapped versions", () => {
    for (const version of [undefined, 0, 3]) {
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
        () =>
          migrateOwnerConfiguration({
            ownerConfigurationVersion: 1,
            sections: [],
          }),
      ),
    );
    expect(error.issues[0]?.keyword).toBe("missingMigration");
  });
});
