import {
  assertDraftPayloadBudget,
  assertNoCredentialMaterial,
  validateSectionPayload,
} from "../../../convex/evidenceLibraries/sectionPayload";
import { EXPORT_FORMATS, readDraft, type SectionRow } from "./rules";
import { AI_PROVIDER } from "./ai";
import catalogs from "./generated/library-config.client.catalogs.json";
import { SECTION_REGISTRY, type SectionKey } from "./section-registry";
import { type ValidationIssue } from "./generated-validation";
import { type OwnerSectionRow, validateOwnerSections } from "./owner-rules";

export const CURRENT_OWNER_CONFIGURATION_VERSION = 4 as const;
export const MAX_CHANGED_POINTERS = 100;

// Version 3 used the runtime catalog pinned when that migration shipped.
// Keep that historical input stable even though the current picker is live.
const VERSION_THREE_AI_MODELS =
  (
    catalogs.options.aiProviders as readonly {
      provider: string;
      active: readonly string[];
    }[]
  ).find((entry) => entry.provider === AI_PROVIDER)?.active ?? [];

export type OwnerConfigurationSnapshotRow = {
  // Historical migrations may receive a section that no longer exists in the
  // current registry. The final current-version validation narrows this to a
  // known SectionKey before owner rules run.
  sectionKey: string;
  payload: unknown;
};

export type OwnerConfigurationSnapshot = {
  ownerConfigurationVersion: number;
  sections: OwnerSectionRow[];
};

export type OwnerConfigurationMigrationSnapshot = {
  ownerConfigurationVersion: number;
  sections: OwnerConfigurationSnapshotRow[];
};

export type OwnerConfigurationDefaultRow = {
  sectionKey: SectionKey;
  payload: () => unknown;
};

export type OwnerConfigurationMigration = {
  from: number;
  to: number;
  migrate: (
    snapshot: OwnerConfigurationMigrationSnapshot,
  ) => OwnerConfigurationMigrationSnapshot;
  defaultRows?: OwnerConfigurationDefaultRow[];
};

export type OwnerConfigurationIssue = {
  pointer: string;
  section: SectionKey | null;
  keyword: string;
  message: string;
};

export type OwnerConfigurationValidationOptions = {
  requireComplete?: boolean;
  requireDeclaredDefaults?: boolean;
};

export type OwnerConfigurationMigrationResult = {
  snapshot: OwnerConfigurationSnapshot;
  changedPointers: string[];
};

export class OwnerConfigurationMigrationError extends Error {
  readonly issues: OwnerConfigurationIssue[];

  constructor(message: string, issues: OwnerConfigurationIssue[]) {
    super(message);
    this.name = "OwnerConfigurationMigrationError";
    this.issues = issues;
  }
}

const SECTION_KEYS = new Set<string>(
  SECTION_REGISTRY.map((section) => section.key),
);
// These names are frozen in the version-1 to version-2 contract. A future
// platform-owned feature must get its own migration decision.
export const LEGACY_FEATURE_KEYS = ["aiSearch", "deepResearch"] as const;

function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === "string" && SECTION_KEYS.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function issue(
  pointer: string,
  keyword: string,
  message: string,
  section: SectionKey | null = null,
): OwnerConfigurationIssue {
  return { pointer, section, keyword, message };
}

function fromValidationIssue(value: ValidationIssue): OwnerConfigurationIssue {
  return {
    pointer: value.pointer,
    section: value.section,
    keyword: value.keyword,
    message: value.message,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasNonBooleanExport(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.values(value).some((entry) => typeof entry !== "boolean");
}

function schemaDefaultExports(): Record<
  (typeof EXPORT_FORMATS)[number],
  boolean
> {
  return {
    ...readDraft([{ sectionKey: "exports", payload: {} } satisfies SectionRow])
      .exports,
  };
}

function validateSnapshotEnvelope(value: unknown): {
  snapshot: OwnerConfigurationMigrationSnapshot | null;
  issues: OwnerConfigurationIssue[];
} {
  const issues: OwnerConfigurationIssue[] = [];
  if (!isRecord(value)) {
    return {
      snapshot: null,
      issues: [issue("", "invalidSnapshot", "Snapshot must be an object.")],
    };
  }

  const rawVersion = value.ownerConfigurationVersion;
  if (rawVersion === undefined) {
    issues.push(
      issue(
        "/ownerConfigurationVersion",
        "missingVersion",
        "Snapshot version is missing.",
      ),
    );
  } else if (
    typeof rawVersion !== "number" ||
    !Number.isSafeInteger(rawVersion)
  ) {
    issues.push(
      issue(
        "/ownerConfigurationVersion",
        "invalidVersion",
        "Snapshot version must be a whole number.",
      ),
    );
  }

  const rawSections = value.sections;
  if (!Array.isArray(rawSections)) {
    issues.push(
      issue("/sections", "invalidSections", "Sections must be an array."),
    );
    return { snapshot: null, issues };
  }

  const rows: OwnerConfigurationSnapshotRow[] = [];
  const seen = new Set<string>();
  let totalByteLength = 0;
  for (const [index, rawRow] of rawSections.entries()) {
    if (!isRecord(rawRow)) {
      issues.push(
        issue(
          `/sections/${index}`,
          "invalidSection",
          "Section row must be an object.",
        ),
      );
      continue;
    }
    const sectionKey = rawRow.sectionKey;
    if (typeof sectionKey !== "string" || sectionKey.length === 0) {
      issues.push(
        issue(
          `/sections/${index}/sectionKey`,
          "invalidSectionKey",
          "Section key must be a non-empty string.",
        ),
      );
      continue;
    }
    if (seen.has(sectionKey)) {
      issues.push(
        issue(
          `/${sectionKey}`,
          "duplicate",
          "Section appears more than once.",
          isSectionKey(sectionKey) ? sectionKey : null,
        ),
      );
    }
    seen.add(sectionKey);
    const payload = rawRow.payload;
    try {
      totalByteLength += validateSectionPayload(payload);
    } catch (error) {
      issues.push(
        issue(
          `/${sectionKey}`,
          "invalidPayload",
          error instanceof Error
            ? error.message
            : "Section payload is invalid.",
          isSectionKey(sectionKey) ? sectionKey : null,
        ),
      );
    }
    rows.push({ sectionKey, payload });
  }

  try {
    assertDraftPayloadBudget(totalByteLength);
  } catch (error) {
    issues.push(
      issue(
        "/sections",
        "payloadBudget",
        error instanceof Error ? error.message : "Snapshot is too large.",
      ),
    );
  }

  const snapshot =
    typeof rawVersion === "number" && Number.isSafeInteger(rawVersion)
      ? {
          ownerConfigurationVersion: rawVersion,
          sections: rows,
        }
      : null;
  return { snapshot, issues };
}

function validateSnapshotShape(
  value: unknown,
  options: OwnerConfigurationValidationOptions,
  migrations: readonly OwnerConfigurationMigration[],
): {
  snapshot: OwnerConfigurationSnapshot | null;
  issues: OwnerConfigurationIssue[];
} {
  const envelope = validateSnapshotEnvelope(value);
  const issues = [...envelope.issues];
  if (!envelope.snapshot) return { snapshot: null, issues };

  const ownerRows: OwnerSectionRow[] = [];
  for (const [index, row] of envelope.snapshot.sections.entries()) {
    if (!isSectionKey(row.sectionKey)) {
      issues.push(
        issue(
          `/sections/${index}/sectionKey`,
          "unknownSection",
          "Section is not part of the configuration contract.",
        ),
      );
      continue;
    }
    ownerRows.push({ sectionKey: row.sectionKey, payload: row.payload });
    try {
      assertNoCredentialMaterial(row.sectionKey, row.payload);
    } catch {
      issues.push(
        issue(
          `/${row.sectionKey}`,
          "credentialMaterial",
          "Keys and passwords cannot be stored in owner configuration.",
          row.sectionKey,
        ),
      );
    }
  }

  const ownerValidation = validateOwnerSections(ownerRows, {
    requireComplete: options.requireComplete,
  });
  issues.push(...ownerValidation.issues.map(fromValidationIssue));
  if (options.requireDeclaredDefaults) {
    issues.push(
      ...declaredDefaultIssues(
        ownerRows,
        envelope.snapshot.ownerConfigurationVersion,
        migrations,
      ),
    );
  }
  if (ownerRows.length !== envelope.snapshot.sections.length) {
    return { snapshot: null, issues };
  }
  return {
    snapshot: {
      ownerConfigurationVersion: envelope.snapshot.ownerConfigurationVersion,
      sections: ownerRows,
    },
    issues,
  };
}

export function validateOwnerConfigurationSnapshot(
  value: unknown,
  options: OwnerConfigurationValidationOptions = {},
): { valid: boolean; issues: OwnerConfigurationIssue[] } {
  const result = validateSnapshotShape(
    value,
    options,
    OWNER_CONFIGURATION_MIGRATIONS,
  );
  return { valid: result.issues.length === 0, issues: result.issues };
}

function requireValidSnapshot(
  value: unknown,
  options: OwnerConfigurationValidationOptions,
  migrations: readonly OwnerConfigurationMigration[],
): OwnerConfigurationSnapshot {
  const result = validateSnapshotShape(value, options, migrations);
  if (result.issues.length > 0 || !result.snapshot) {
    throw new OwnerConfigurationMigrationError(
      "Evidence Library configuration snapshot is invalid",
      result.issues,
    );
  }
  return result.snapshot;
}

function defaultRowsForVersion(
  version: number,
  migrations: readonly OwnerConfigurationMigration[],
): readonly OwnerConfigurationDefaultRow[] {
  return (
    migrations.find((migration) => migration.to === version)?.defaultRows ?? []
  );
}

export function completeOwnerConfigurationSnapshot<
  T extends OwnerConfigurationMigrationSnapshot,
>(
  snapshot: T,
  migrations: readonly OwnerConfigurationMigration[] = OWNER_CONFIGURATION_MIGRATIONS,
): T {
  const next = cloneJson(snapshot);
  const existing = new Set(next.sections.map((row) => row.sectionKey));
  for (const defaultRow of defaultRowsForVersion(
    next.ownerConfigurationVersion,
    migrations,
  )) {
    if (existing.has(defaultRow.sectionKey)) continue;
    next.sections.push({
      sectionKey: defaultRow.sectionKey,
      payload: cloneJson(defaultRow.payload()),
    });
    existing.add(defaultRow.sectionKey);
  }
  return next;
}

function declaredDefaultIssues(
  rows: readonly OwnerSectionRow[],
  version: number,
  migrations: readonly OwnerConfigurationMigration[],
): OwnerConfigurationIssue[] {
  const present = new Set(rows.map((row) => row.sectionKey));
  return defaultRowsForVersion(version, migrations)
    .filter((defaultRow) => !present.has(defaultRow.sectionKey))
    .map((defaultRow) =>
      issue(
        `/${defaultRow.sectionKey}`,
        "missingDefault",
        "A declared default section row is missing.",
        defaultRow.sectionKey,
      ),
    );
}

function migrateVersionOneToTwo(
  snapshot: OwnerConfigurationMigrationSnapshot,
): OwnerConfigurationMigrationSnapshot {
  const next = cloneJson(snapshot);
  next.ownerConfigurationVersion = 2;
  for (const row of next.sections) {
    if (row.sectionKey === "features" && isRecord(row.payload)) {
      const payload = { ...row.payload };
      for (const key of LEGACY_FEATURE_KEYS) delete payload[key];
      row.payload = payload;
    }
    if (row.sectionKey === "identity" && isRecord(row.payload)) {
      if (!hasOwn(row.payload, "assets")) {
        row.payload = { ...row.payload, assets: {} };
      }
    }
    if (row.sectionKey === "exports" && hasNonBooleanExport(row.payload)) {
      row.payload = schemaDefaultExports();
    }
  }
  return completeOwnerConfigurationSnapshot(next);
}

function migrateVersionTwoToThree(
  snapshot: OwnerConfigurationMigrationSnapshot,
): OwnerConfigurationMigrationSnapshot {
  const next = cloneJson(snapshot);
  const activeModels = new Set(VERSION_THREE_AI_MODELS);
  let disableAiAnswers = false;
  next.ownerConfigurationVersion = 3;
  for (const row of next.sections) {
    if (row.sectionKey !== "ai" || !isRecord(row.payload)) continue;
    const providers = Array.isArray(row.payload.providers)
      ? row.payload.providers
      : [];
    row.payload = {
      providers: providers.map((value) => {
        const provider = isRecord(value) ? value : {};
        const enabled = provider.enabled === true;
        if (!enabled) {
          return { provider: provider.provider, enabled: false, models: [] };
        }
        const listedModels = Array.isArray(provider.models)
          ? provider.models.filter(
              (model): model is string => typeof model === "string",
            )
          : [];
        const savedDefault =
          typeof provider.defaultModel === "string"
            ? provider.defaultModel
            : undefined;
        const candidates = [
          ...listedModels,
          ...(savedDefault ? [savedDefault] : []),
        ];
        const selectedModels = new Set<string>();
        const models: string[] = [];
        for (const model of candidates) {
          if (!activeModels.has(model) || selectedModels.has(model)) continue;
          selectedModels.add(model);
          models.push(model);
        }
        if (models.length === 0) {
          disableAiAnswers = true;
          return { provider: provider.provider, enabled: false, models: [] };
        }
        const defaultModel =
          savedDefault && models.includes(savedDefault)
            ? savedDefault
            : models[0];
        return {
          provider: provider.provider,
          enabled: true,
          models,
          ...(defaultModel ? { defaultModel } : {}),
        };
      }),
    };
  }
  if (disableAiAnswers) {
    const features = next.sections.find(
      (row) => row.sectionKey === "features" && isRecord(row.payload),
    );
    if (features && isRecord(features.payload)) {
      features.payload = { ...features.payload, ai: false };
    }
  }
  return completeOwnerConfigurationSnapshot(next);
}

function migrateVersionThreeToFour(
  snapshot: OwnerConfigurationMigrationSnapshot,
): OwnerConfigurationMigrationSnapshot {
  const next = cloneJson(snapshot);
  next.ownerConfigurationVersion = 4;
  for (const row of next.sections) {
    if (!isRecord(row.payload)) continue;
    const payload = { ...row.payload };
    if (row.sectionKey === "search") delete payload.authorCountry;
    if (row.sectionKey === "filters") delete payload.countryLibrary;
    if (row.sectionKey === "features") delete payload.authorLocation;
    row.payload = payload;
  }
  return completeOwnerConfigurationSnapshot(next);
}

export const OWNER_CONFIGURATION_MIGRATIONS: OwnerConfigurationMigration[] = [
  {
    from: 1,
    to: 2,
    migrate: migrateVersionOneToTwo,
    defaultRows: [
      {
        sectionKey: "ai",
        payload: () => ({
          providers: [{ provider: AI_PROVIDER, enabled: false }],
        }),
      },
    ],
  },
  {
    from: 2,
    to: 3,
    migrate: migrateVersionTwoToThree,
    defaultRows: [
      {
        sectionKey: "ai",
        payload: () => ({
          providers: [{ provider: AI_PROVIDER, enabled: false, models: [] }],
        }),
      },
    ],
  },
  {
    from: 3,
    to: 4,
    migrate: migrateVersionThreeToFour,
    defaultRows: [
      {
        sectionKey: "ai",
        payload: () => ({
          providers: [{ provider: AI_PROVIDER, enabled: false, models: [] }],
        }),
      },
    ],
  },
];

export const ownerConfigurationMigrations = OWNER_CONFIGURATION_MIGRATIONS;

export function validateOwnerConfigurationMigrationRegistry(
  migrations: readonly OwnerConfigurationMigration[],
  currentVersion: number = CURRENT_OWNER_CONFIGURATION_VERSION,
): OwnerConfigurationIssue[] {
  const issues: OwnerConfigurationIssue[] = [];
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 1) {
    return [
      issue(
        "/migrations",
        "invalidRegistry",
        "The current configuration version must be a positive whole number.",
      ),
    ];
  }

  const seenFrom = new Set<number>();
  const seenTo = new Set<number>();
  const validTargets: number[] = [];
  let previousFrom: number | null = null;
  for (const [index, migration] of migrations.entries()) {
    const pointer = `/migrations/${index}`;
    if (
      !Number.isSafeInteger(migration.from) ||
      !Number.isSafeInteger(migration.to)
    ) {
      issues.push(
        issue(
          pointer,
          "invalidRegistry",
          "Migration versions must be whole numbers.",
        ),
      );
      continue;
    }
    if (
      migration.from < 1 ||
      migration.to < 1 ||
      migration.to > currentVersion
    ) {
      issues.push(
        issue(
          pointer,
          "invalidRegistry",
          "Migration versions must stay within the supported range.",
        ),
      );
    }
    if (migration.to !== migration.from + 1) {
      issues.push(
        issue(
          pointer,
          "nonConsecutiveMigration",
          "Each migration must move exactly one version forward.",
        ),
      );
    }
    if (previousFrom !== null && migration.from <= previousFrom) {
      issues.push(
        issue(
          pointer,
          "outOfOrderMigration",
          "Migration steps must be declared in ascending order.",
        ),
      );
    }
    previousFrom = migration.from;
    if (seenFrom.has(migration.from) || seenTo.has(migration.to)) {
      issues.push(
        issue(
          pointer,
          "duplicateMigration",
          "Each migration boundary may be declared only once.",
        ),
      );
    }
    seenFrom.add(migration.from);
    seenTo.add(migration.to);
    validTargets.push(migration.to);
  }

  const maxTarget = validTargets.length > 0 ? Math.max(...validTargets) : null;
  if (maxTarget !== currentVersion) {
    issues.push(
      issue(
        "/migrations",
        "invalidRegistry",
        "The migration registry must end at the current configuration version.",
      ),
    );
  }
  for (let version = 1; version < currentVersion; version += 1) {
    if (seenFrom.has(version)) continue;
    issues.push(
      issue(
        `/migrations/${version}`,
        "missingMigration",
        "No consecutive migration exists for this configuration version.",
      ),
    );
  }
  return issues;
}

function requireValidMigrationRegistry(
  migrations: readonly OwnerConfigurationMigration[],
  currentVersion: number,
): void {
  const issues = validateOwnerConfigurationMigrationRegistry(
    migrations,
    currentVersion,
  );
  if (issues.length > 0) {
    throw new OwnerConfigurationMigrationError(
      "Evidence Library configuration migration registry is invalid",
      issues,
    );
  }
}

function pointerJoin(pointer: string, key: string): string {
  return `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function diffJsonPointers(
  before: unknown,
  after: unknown,
  pointer: string,
  output: string[],
): void {
  if (output.length >= MAX_CHANGED_POINTERS) return;
  if (Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      if (output.length >= MAX_CHANGED_POINTERS) return;
      if (index >= before.length || index >= after.length) {
        output.push(pointerJoin(pointer, String(index)));
      } else {
        diffJsonPointers(
          before[index],
          after[index],
          pointerJoin(pointer, String(index)),
          output,
        );
      }
    }
    return;
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    for (const key of keys) {
      if (output.length >= MAX_CHANGED_POINTERS) return;
      const child = pointerJoin(pointer, key);
      if (!hasOwn(before, key) || !hasOwn(after, key)) {
        output.push(child);
      } else {
        diffJsonPointers(before[key], after[key], child, output);
      }
    }
    return;
  }
  output.push(pointer || "");
}

function changedSnapshotPointers(
  before: OwnerConfigurationMigrationSnapshot,
  after: OwnerConfigurationMigrationSnapshot,
): string[] {
  const output: string[] = [];
  const beforeRows = new Map(
    before.sections.map((row) => [row.sectionKey, row.payload]),
  );
  const afterRows = new Map(
    after.sections.map((row) => [row.sectionKey, row.payload]),
  );
  const keys = [
    ...before.sections.map((row) => row.sectionKey),
    ...after.sections.map((row) => row.sectionKey),
  ].filter((key, index, all) => all.indexOf(key) === index);
  for (const key of keys) {
    if (output.length >= MAX_CHANGED_POINTERS) break;
    const beforePayload = beforeRows.get(key);
    const afterPayload = afterRows.get(key);
    if (!beforeRows.has(key) || !afterRows.has(key)) {
      output.push(pointerJoin("", key));
      continue;
    }
    if (
      key === "exports" &&
      JSON.stringify(beforePayload) !== JSON.stringify(afterPayload)
    ) {
      output.push("/exports");
      continue;
    }
    diffJsonPointers(beforePayload, afterPayload, pointerJoin("", key), output);
  }
  return output;
}

export function migrateOwnerConfiguration(
  value: unknown,
  options: OwnerConfigurationValidationOptions = {},
  migrations: readonly OwnerConfigurationMigration[] = OWNER_CONFIGURATION_MIGRATIONS,
  targetVersion: number = CURRENT_OWNER_CONFIGURATION_VERSION,
): OwnerConfigurationMigrationResult {
  requireValidMigrationRegistry(migrations, targetVersion);
  const initial = validateSnapshotEnvelope(value);
  if (initial.issues.length > 0 || !initial.snapshot) {
    throw new OwnerConfigurationMigrationError(
      "Evidence Library configuration snapshot is invalid",
      initial.issues,
    );
  }

  const rawVersion = isRecord(value)
    ? value.ownerConfigurationVersion
    : undefined;
  if (typeof rawVersion === "number" && Number.isSafeInteger(rawVersion)) {
    if (rawVersion > targetVersion) {
      throw new OwnerConfigurationMigrationError(
        "Evidence Library configuration snapshot is newer than this code",
        [
          issue(
            "/ownerConfigurationVersion",
            "futureVersion",
            "Snapshot version is newer than this code supports.",
          ),
        ],
      );
    }
    if (rawVersion < 1) {
      throw new OwnerConfigurationMigrationError(
        "Evidence Library configuration snapshot has an unknown version",
        [
          issue(
            "/ownerConfigurationVersion",
            "unknownVersion",
            "Snapshot version is not supported.",
          ),
        ],
      );
    }
  }

  let current = cloneJson(initial.snapshot);
  const changedPointers: string[] = [];
  while (current.ownerConfigurationVersion < targetVersion) {
    const migration = migrations.find(
      (candidate) => candidate.from === current.ownerConfigurationVersion,
    );
    if (!migration || migration.to !== migration.from + 1) {
      throw new OwnerConfigurationMigrationError(
        "Evidence Library configuration migration path is incomplete",
        [
          issue(
            "/ownerConfigurationVersion",
            "missingMigration",
            "No consecutive migration exists for this snapshot version.",
          ),
        ],
      );
    }
    const before = current;
    let migrated: unknown;
    try {
      migrated = migration.migrate(cloneJson(current));
    } catch (error) {
      if (error instanceof OwnerConfigurationMigrationError) throw error;
      throw new OwnerConfigurationMigrationError(
        "Evidence Library configuration migration failed",
        [
          issue(
            "/sections",
            "migrationFailed",
            "A configuration migration could not interpret this snapshot.",
          ),
        ],
      );
    }
    if (
      !isRecord(migrated) ||
      migrated.ownerConfigurationVersion !== migration.to
    ) {
      throw new OwnerConfigurationMigrationError(
        "Evidence Library configuration migration returned an invalid snapshot",
        [
          issue(
            "/ownerConfigurationVersion",
            "invalidMigrationOutput",
            "A configuration migration returned the wrong version.",
          ),
        ],
      );
    }
    const checked = validateSnapshotEnvelope(migrated);
    if (checked.issues.length > 0 || !checked.snapshot) {
      throw new OwnerConfigurationMigrationError(
        "Evidence Library configuration migration returned an invalid snapshot",
        checked.issues,
      );
    }
    current = cloneJson(checked.snapshot);
    if (
      before.ownerConfigurationVersion !== current.ownerConfigurationVersion &&
      !changedPointers.includes("/ownerConfigurationVersion")
    ) {
      changedPointers.push("/ownerConfigurationVersion");
    }
    for (const pointer of changedSnapshotPointers(before, current)) {
      if (!changedPointers.includes(pointer)) changedPointers.push(pointer);
      if (changedPointers.length >= MAX_CHANGED_POINTERS) break;
    }
  }

  const final = requireValidSnapshot(current, options, migrations);
  return {
    snapshot: cloneJson(final),
    changedPointers: changedPointers.slice(0, MAX_CHANGED_POINTERS),
  };
}
