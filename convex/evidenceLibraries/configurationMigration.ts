import { paginationOptsValidator } from "convex/server";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  CURRENT_OWNER_CONFIGURATION_VERSION,
  LEGACY_FEATURE_KEYS,
  migrateOwnerConfiguration,
  type OwnerConfigurationIssue,
} from "../../lib/evidence-libraries/configuration/owner-configuration-migrations";
import { SECTION_REGISTRY } from "../../lib/evidence-libraries/configuration/section-registry";
import { loadConfigurationSections } from "./configurationSnapshot";

const AUDIT_PAGE_SIZE = 25;
const MAX_FINDINGS_PER_ENTRY = 20;
const MAX_SAMPLES_PER_PAGE = 20;

const auditStageValidator = v.union(
  v.literal("drafts"),
  v.literal("revisions"),
  v.literal("sections"),
);
const auditCategoryValidator = v.union(
  v.literal("missingVersion"),
  v.literal("unknownVersion"),
  v.literal("staleFeatures"),
  v.literal("nonBooleanExports"),
  v.literal("brokenParent"),
  v.literal("duplicateSection"),
  v.literal("migrationValidationFailure"),
);
const auditFindingValidator = v.object({
  category: auditCategoryValidator,
  pointer: v.string(),
  message: v.string(),
});
const auditEntryValidator = v.object({
  kind: v.union(
    v.literal("draft"),
    v.literal("revision"),
    v.literal("section"),
  ),
  id: v.string(),
  ownerConfigurationVersion: v.optional(v.number()),
  findings: v.array(auditFindingValidator),
});
const auditCountsValidator = v.object({
  scanned: v.number(),
  missingVersions: v.number(),
  unknownVersions: v.number(),
  staleFeatures: v.number(),
  nonBooleanExports: v.number(),
  brokenParents: v.number(),
  duplicateSections: v.number(),
  migrationValidationFailures: v.number(),
  placeholderRevisions: v.number(),
});
const auditSampleValidator = v.object({
  kind: v.union(
    v.literal("draft"),
    v.literal("revision"),
    v.literal("section"),
  ),
  id: v.string(),
  category: auditCategoryValidator,
  pointer: v.string(),
  message: v.string(),
});

export const auditPageReturnValidator = v.object({
  stage: auditStageValidator,
  page: v.array(auditEntryValidator),
  counts: auditCountsValidator,
  samples: v.array(auditSampleValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

type AuditStage = "drafts" | "revisions" | "sections";
type AuditKind = "draft" | "revision" | "section";
type AuditCategory =
  | "missingVersion"
  | "unknownVersion"
  | "staleFeatures"
  | "nonBooleanExports"
  | "brokenParent"
  | "duplicateSection"
  | "migrationValidationFailure";
type AuditFinding = {
  category: AuditCategory;
  pointer: string;
  message: string;
};

export function auditHeaderVersion(
  version: number | undefined,
  isPlaceholderRevision: boolean,
): AuditFinding | null {
  if (version === undefined) {
    return {
      category: "missingVersion",
      pointer: "/ownerConfigurationVersion",
      message: "Snapshot version is missing.",
    };
  }
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > CURRENT_OWNER_CONFIGURATION_VERSION
  ) {
    return {
      category: "unknownVersion",
      pointer: "/ownerConfigurationVersion",
      message: isPlaceholderRevision
        ? "Header-only snapshot version is not supported by this code."
        : "Snapshot version is not supported by this code.",
    };
  }
  return null;
}

type AuditSample = AuditFinding & {
  kind: AuditKind;
  id: string;
};
type AuditEntry = {
  kind: AuditKind;
  id: string;
  ownerConfigurationVersion?: number;
  findings: AuditFinding[];
};
type AuditCursor = { stage: AuditStage; cursor: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasNonBooleanExports(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).some((entry) => typeof entry !== "boolean")
  );
}

function encodeCursor(cursor: AuditCursor): string {
  return JSON.stringify(cursor);
}

function decodeCursor(value: string | null): AuditCursor {
  if (!value) return { stage: "drafts", cursor: null };
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      isRecord(parsed) &&
      (parsed.stage === "drafts" ||
        parsed.stage === "revisions" ||
        parsed.stage === "sections") &&
      (parsed.cursor === null || typeof parsed.cursor === "string")
    ) {
      return parsed as AuditCursor;
    }
  } catch {
    // The cursor is opaque to callers. Treat malformed state as invalid.
  }
  throw new Error("Invalid Evidence Library configuration audit cursor");
}

function emptyCounts(): AuditCounts {
  return {
    scanned: 0,
    missingVersions: 0,
    unknownVersions: 0,
    staleFeatures: 0,
    nonBooleanExports: 0,
    brokenParents: 0,
    duplicateSections: 0,
    migrationValidationFailures: 0,
    placeholderRevisions: 0,
  };
}

type AuditCounts = {
  scanned: number;
  missingVersions: number;
  unknownVersions: number;
  staleFeatures: number;
  nonBooleanExports: number;
  brokenParents: number;
  duplicateSections: number;
  migrationValidationFailures: number;
  placeholderRevisions: number;
};

function countFor(category: AuditCategory): keyof AuditCounts {
  switch (category) {
    case "missingVersion":
      return "missingVersions";
    case "unknownVersion":
      return "unknownVersions";
    case "staleFeatures":
      return "staleFeatures";
    case "nonBooleanExports":
      return "nonBooleanExports";
    case "brokenParent":
      return "brokenParents";
    case "duplicateSection":
      return "duplicateSections";
    case "migrationValidationFailure":
      return "migrationValidationFailures";
  }
}

function addFinding(
  entry: AuditEntry,
  counts: AuditCounts,
  samples: AuditSample[],
  finding: AuditFinding,
): void {
  const countKey = countFor(finding.category);
  counts[countKey] += 1;
  if (entry.findings.length < MAX_FINDINGS_PER_ENTRY) {
    entry.findings.push(finding);
  }
  if (samples.length < MAX_SAMPLES_PER_PAGE) {
    samples.push({
      kind: entry.kind,
      id: entry.id,
      ...finding,
    });
  }
}

function addValidationFindings(
  entry: AuditEntry,
  counts: AuditCounts,
  samples: AuditSample[],
  issues: readonly OwnerConfigurationIssue[],
): void {
  for (const value of issues.slice(0, MAX_FINDINGS_PER_ENTRY)) {
    addFinding(entry, counts, samples, {
      category: "migrationValidationFailure",
      pointer: value.pointer,
      message: value.message,
    });
  }
}

type Header =
  | Doc<"evidenceLibraryConfigDrafts">
  | Doc<"evidenceLibraryConfigRevisions">;

async function auditHeader(
  ctx: QueryCtx,
  header: Header,
  kind: "draft" | "revision",
  counts: AuditCounts,
  samples: AuditSample[],
): Promise<AuditEntry> {
  const entry: AuditEntry = {
    kind,
    id: header._id,
    findings: [],
  };
  counts.scanned += 1;
  if (header.ownerConfigurationVersion !== undefined) {
    entry.ownerConfigurationVersion = header.ownerConfigurationVersion;
  }

  const rows = await loadConfigurationSections(ctx, kind, header._id);
  const isPlaceholderRevision = kind === "revision" && rows.length === 0;
  if (isPlaceholderRevision) counts.placeholderRevisions += 1;
  const versionFinding = auditHeaderVersion(
    header.ownerConfigurationVersion,
    isPlaceholderRevision,
  );
  if (versionFinding) addFinding(entry, counts, samples, versionFinding);
  const library =
    kind === "draft"
      ? await ctx.db.get(
          "evidenceLibraries",
          (header as Doc<"evidenceLibraryConfigDrafts">).libraryId,
        )
      : null;
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.kind !== kind) {
      addFinding(entry, counts, samples, {
        category: "brokenParent",
        pointer: "/sections",
        message: "Section row has the wrong parent kind.",
      });
      continue;
    }
    if (seen.has(row.sectionKey)) {
      addFinding(entry, counts, samples, {
        category: "duplicateSection",
        pointer: `/${row.sectionKey}`,
        message: "Section appears more than once.",
      });
    }
    seen.add(row.sectionKey);
    if (row.sectionKey === "features" && isRecord(row.payload)) {
      for (const key of LEGACY_FEATURE_KEYS) {
        if (!hasOwn(row.payload, key)) continue;
        addFinding(entry, counts, samples, {
          category: "staleFeatures",
          pointer: `/features/${key}`,
          message: "Feature is no longer stored in owner configuration.",
        });
      }
    }
    if (row.sectionKey === "exports" && hasNonBooleanExports(row.payload)) {
      addFinding(entry, counts, samples, {
        category: "nonBooleanExports",
        pointer: "/exports",
        message: "Export values must be booleans.",
      });
    }
  }
  if (rows.length > SECTION_REGISTRY.length) {
    addFinding(entry, counts, samples, {
      category: "duplicateSection",
      pointer: "/sections",
      message: "The snapshot has more section rows than the registry allows.",
    });
  }

  if (kind === "draft") {
    const draftHeader = header as Doc<"evidenceLibraryConfigDrafts">;
    if (draftHeader.baseRevisionId !== null) {
      const parent = await ctx.db.get(
        "evidenceLibraryConfigRevisions",
        draftHeader.baseRevisionId,
      );
      if (!parent || parent.libraryId !== header.libraryId) {
        addFinding(entry, counts, samples, {
          category: "brokenParent",
          pointer: "/baseRevisionId",
          message:
            "Draft base revision is missing or belongs to another library.",
        });
      }
    }
  } else {
    const revisionHeader = header as Doc<"evidenceLibraryConfigRevisions">;
    for (const [pointer, parentId] of [
      ["/basedOnRevisionId", revisionHeader.basedOnRevisionId],
      ["/rollbackOfRevisionId", revisionHeader.rollbackOfRevisionId],
    ] as const) {
      if (parentId === null) continue;
      const parent = await ctx.db.get(
        "evidenceLibraryConfigRevisions",
        parentId,
      );
      if (
        !parent ||
        parent.libraryId !== header.libraryId ||
        parent._id === header._id
      ) {
        addFinding(entry, counts, samples, {
          category: "brokenParent",
          pointer,
          message:
            "Revision parent is missing, self-referential, or belongs to another library.",
        });
      }
    }
  }

  if (header.ownerConfigurationVersion !== undefined) {
    const version = header.ownerConfigurationVersion;
    const supportedVersion =
      Number.isSafeInteger(version) &&
      version >= 1 &&
      version <= CURRENT_OWNER_CONFIGURATION_VERSION;
    if (supportedVersion && !isPlaceholderRevision) {
      try {
        migrateOwnerConfiguration(
          {
            ownerConfigurationVersion: version,
            sections: rows
              .filter((row) => row.kind === kind)
              .map((row) => ({
                sectionKey: row.sectionKey,
                payload: row.payload,
              })),
          },
          {
            requireComplete:
              kind === "revision" ||
              (kind === "draft" &&
                library !== null &&
                library.state !== "provisioning"),
            requireDeclaredDefaults:
              kind === "revision" ||
              (kind === "draft" &&
                library !== null &&
                library.state !== "provisioning"),
          },
        );
      } catch (error) {
        if (error instanceof Error && "issues" in error) {
          addValidationFindings(
            entry,
            counts,
            samples,
            (error as { issues: OwnerConfigurationIssue[] }).issues,
          );
        } else {
          addFinding(entry, counts, samples, {
            category: "migrationValidationFailure",
            pointer: "/sections",
            message: "Snapshot validation failed.",
          });
        }
      }
    }
  }
  return entry;
}

async function auditSection(
  ctx: QueryCtx,
  row: Doc<"evidenceLibraryConfigSections">,
  counts: AuditCounts,
  samples: AuditSample[],
): Promise<AuditEntry> {
  const entry: AuditEntry = {
    kind: "section",
    id: row._id,
    findings: [],
  };
  counts.scanned += 1;
  const parent =
    row.kind === "draft"
      ? await ctx.db.get("evidenceLibraryConfigDrafts", row.draftId)
      : await ctx.db.get("evidenceLibraryConfigRevisions", row.revisionId);
  if (!parent || parent.libraryId !== row.libraryId) {
    addFinding(entry, counts, samples, {
      category: "brokenParent",
      pointer: row.kind === "draft" ? "/draftId" : "/revisionId",
      message: "Section row parent is missing or belongs to another library.",
    });
  }
  return entry;
}

async function readPage(
  ctx: QueryCtx,
  stage: AuditStage,
  cursor: string | null,
  numItems: number,
  counts: AuditCounts,
  samples: AuditSample[],
): Promise<{
  page: AuditEntry[];
  isDone: boolean;
  continueCursor: string;
}> {
  if (stage === "drafts") {
    const raw = await ctx.db
      .query("evidenceLibraryConfigDrafts")
      .paginate({ numItems, cursor });
    const page: AuditEntry[] = [];
    for (const header of raw.page) {
      page.push(await auditHeader(ctx, header, "draft", counts, samples));
    }
    return {
      page,
      isDone: false,
      continueCursor: encodeCursor(
        raw.isDone
          ? { stage: "revisions", cursor: null }
          : { stage, cursor: raw.continueCursor },
      ),
    };
  }
  if (stage === "revisions") {
    const raw = await ctx.db
      .query("evidenceLibraryConfigRevisions")
      .paginate({ numItems, cursor });
    const page: AuditEntry[] = [];
    for (const header of raw.page) {
      page.push(await auditHeader(ctx, header, "revision", counts, samples));
    }
    return {
      page,
      isDone: false,
      continueCursor: encodeCursor(
        raw.isDone
          ? { stage: "sections", cursor: null }
          : { stage, cursor: raw.continueCursor },
      ),
    };
  }
  const raw = await ctx.db
    .query("evidenceLibraryConfigSections")
    .paginate({ numItems, cursor });
  const page: AuditEntry[] = [];
  for (const row of raw.page) {
    page.push(await auditSection(ctx, row, counts, samples));
  }
  return {
    page,
    isDone: raw.isDone,
    continueCursor: raw.isDone
      ? ""
      : encodeCursor({ stage: "sections", cursor: raw.continueCursor }),
  };
}

export const auditPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: auditPageReturnValidator,
  handler: async (ctx, args) => {
    const decoded = decodeCursor(args.paginationOpts.cursor);
    const counts = emptyCounts();
    const samples: AuditSample[] = [];
    const numItems = Math.min(
      AUDIT_PAGE_SIZE,
      Math.max(1, Math.floor(args.paginationOpts.numItems)),
    );
    const stage = decoded.stage;
    const result = await readPage(
      ctx,
      stage,
      decoded.cursor,
      numItems,
      counts,
      samples,
    );
    return {
      stage,
      page: result.page,
      counts,
      samples,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
