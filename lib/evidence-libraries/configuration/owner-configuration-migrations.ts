import {
  assertDraftPayloadBudget,
  assertNoCredentialMaterial,
  validateSectionPayload,
} from "../../../convex/evidenceLibraries/sectionPayload";
import {
  type ValidationIssue,
  validateSectionStructure,
} from "./generated-validation";
import { readDraft, type SectionRow } from "./rules";
import {
  SECTION_REGISTRY,
  type SectionKey,
} from "./section-registry";
import {
  type OwnerSectionRow,
  validateOwnerSections,
} from "./owner-rules";

export const CURRENT_OWNER_CONFIGURATION_VERSION = 2 as const;
export const MAX_CHANGED_POINTERS = 100;

export type OwnerConfigurationSnapshot = {
  ownerConfigurationVersion: number;
  sections: OwnerSectionRow[];
};

export type OwnerConfigurationMigration = {
  from: number;
  to: number;
  migrate: (
    snapshot: OwnerConfigurationSnapshot,
  ) => OwnerConfigurationSnapshot;
};

export type OwnerConfigurationIssue = {
  pointer: string;
  section: SectionKey | null;
  keyword: string;
  message: string;
};

export type OwnerConfigurationValidationOptions = {
  requireComplete?: boolean;
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
const LEGACY_FEATURE_KEYS = ["aiSearch", "deepResearch"] as const;
const EXPORT_KEYS = ["ris", "bibtex", "atom"] as const;

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

function schemaDefaultExports(): Record<(typeof EXPORT_KEYS)[number], boolean> {
  return {
    ...readDraft([
      { sectionKey: "exports", payload: {} } satisfies SectionRow,
    ]).exports,
  };
}

function legacyValidationPayload(
  sectionKey: string,
  payload: unknown,
): unknown {
  if (!isRecord(payload)) return payload;
  if (sectionKey === "features") {
    const next = { ...payload };
    for (const key of LEGACY_FEATURE_KEYS) delete next[key];
    return next;
  }
  if (sectionKey === "exports" && hasNonBooleanExport(payload)) {
    return schemaDefaultExports();
  }
  return payload;
}

function legacyAllowedStructureIssue(
  sectionKey: string,
  payload: unknown,
  value: ValidationIssue,
): boolean {
  if (sectionKey === "features" && isRecord(payload)) {
    return LEGACY_FEATURE_KEYS.some(
      (key) =>
        typeof payload[key] === "boolean" &&
        value.pointer === `/features/${key}`,
    );
  }
  if (sectionKey === "exports" && hasNonBooleanExport(payload)) {
    return (
      value.keyword === "type" &&
      EXPORT_KEYS.some((key) => value.pointer === `/exports/${key}`)
    );
  }
  return false;
}

function sectionRowsForValidation(
  rows: readonly OwnerSectionRow[],
  version: number,
): OwnerSectionRow[] {
  if (version !== 1) return rows.map((row) => ({ ...row }));
  return rows.map((row) => ({
    sectionKey: row.sectionKey,
    payload: legacyValidationPayload(row.sectionKey, row.payload),
  }));
}

function validateSnapshotShape(
  value: unknown,
  options: OwnerConfigurationValidationOptions,
): { snapshot: OwnerConfigurationSnapshot | null; issues: OwnerConfigurationIssue[] } {
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
    issues.push(issue("/sections", "invalidSections", "Sections must be an array."));
    return { snapshot: null, issues };
  }

  const rows: OwnerSectionRow[] = [];
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
    if (!isSectionKey(sectionKey)) {
      issues.push(
        issue(
          `/sections/${index}/sectionKey`,
          "unknownSection",
          "Section is not part of the configuration contract.",
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
          sectionKey,
        ),
      );
    }
    seen.add(sectionKey);
    const payload = rawRow.payload;
    let payloadValid = true;
    try {
      totalByteLength += validateSectionPayload(payload);
    } catch (error) {
      payloadValid = false;
      issues.push(
        issue(
          `/${sectionKey}`,
          "invalidPayload",
          error instanceof Error
            ? error.message
            : "Section payload is invalid.",
          sectionKey,
        ),
      );
    }
    try {
      assertNoCredentialMaterial(sectionKey, payload);
    } catch {
      issues.push(
        issue(
          `/${sectionKey}`,
          "credentialMaterial",
          "Keys and passwords cannot be stored in owner configuration.",
          sectionKey,
        ),
      );
    }

    const row = { sectionKey, payload } as OwnerSectionRow;
    rows.push(row);
    if (!payloadValid) continue;
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

  const version = rawVersion;
  if (typeof version === "number" && Number.isSafeInteger(version)) {
    const legacy = version === 1;
    for (const row of rows) {
      const structureIssues = validateSectionStructure(
        row.sectionKey,
        row.payload,
      ).issues.filter(
        (value) =>
          !legacy ||
          !legacyAllowedStructureIssue(row.sectionKey, row.payload, value),
      );
      issues.push(...structureIssues.map(fromValidationIssue));
    }

    const ownerValidation = validateOwnerSections(
      sectionRowsForValidation(rows, version),
      { requireComplete: options.requireComplete },
    );
    issues.push(...ownerValidation.issues.map(fromValidationIssue));
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

export function validateOwnerConfigurationSnapshot(
  value: unknown,
  options: OwnerConfigurationValidationOptions = {},
): { valid: boolean; issues: OwnerConfigurationIssue[] } {
  const result = validateSnapshotShape(value, options);
  return { valid: result.issues.length === 0, issues: result.issues };
}

function requireValidSnapshot(
  value: unknown,
  options: OwnerConfigurationValidationOptions,
): OwnerConfigurationSnapshot {
  const result = validateSnapshotShape(value, options);
  if (result.issues.length > 0 || !result.snapshot) {
    throw new OwnerConfigurationMigrationError(
      "Evidence Library configuration snapshot is invalid",
      result.issues,
    );
  }
  return result.snapshot;
}

function migrateVersionOneToTwo(
  snapshot: OwnerConfigurationSnapshot,
): OwnerConfigurationSnapshot {
  const next = cloneJson(snapshot);
  next.ownerConfigurationVersion = CURRENT_OWNER_CONFIGURATION_VERSION;
  for (const row of next.sections) {
    if (row.sectionKey === "features" && isRecord(row.payload)) {
      const payload = { ...row.payload };
      for (const key of LEGACY_FEATURE_KEYS) delete payload[key];
      row.payload = payload;
    }
    if (
      row.sectionKey === "exports" &&
      hasNonBooleanExport(row.payload)
    ) {
      row.payload = schemaDefaultExports();
    }
  }
  return next;
}

export const OWNER_CONFIGURATION_MIGRATIONS: OwnerConfigurationMigration[] = [
  {
    from: 1,
    to: CURRENT_OWNER_CONFIGURATION_VERSION,
    migrate: migrateVersionOneToTwo,
  },
];

export const ownerConfigurationMigrations = OWNER_CONFIGURATION_MIGRATIONS;

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
  before: OwnerConfigurationSnapshot,
  after: OwnerConfigurationSnapshot,
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
      output.push(`/${key}`);
      continue;
    }
    if (key === "exports" && JSON.stringify(beforePayload) !== JSON.stringify(afterPayload)) {
      output.push("/exports");
      continue;
    }
    diffJsonPointers(beforePayload, afterPayload, `/${key}`, output);
  }
  return output;
}

export function migrateOwnerConfiguration(
  value: OwnerConfigurationSnapshot,
  options: OwnerConfigurationValidationOptions = {},
): OwnerConfigurationMigrationResult {
  const initial = requireValidSnapshot(value, options);
  if (
    initial.ownerConfigurationVersion > CURRENT_OWNER_CONFIGURATION_VERSION
  ) {
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
  if (initial.ownerConfigurationVersion < 1) {
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

  let current = cloneJson(initial);
  const changedPointers: string[] = [];
  while (
    current.ownerConfigurationVersion < CURRENT_OWNER_CONFIGURATION_VERSION
  ) {
    const migration = OWNER_CONFIGURATION_MIGRATIONS.find(
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
    let migrated: OwnerConfigurationSnapshot;
    try {
      migrated = migration.migrate(cloneJson(current));
    } catch {
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
    const checked = requireValidSnapshot(migrated, options);
    current = cloneJson(checked);
    for (const pointer of changedSnapshotPointers(before, current)) {
      if (!changedPointers.includes(pointer)) changedPointers.push(pointer);
      if (changedPointers.length >= MAX_CHANGED_POINTERS) break;
    }
  }

  const final = requireValidSnapshot(current, options);
  return {
    snapshot: cloneJson(final),
    changedPointers: changedPointers.slice(0, MAX_CHANGED_POINTERS),
  };
}
