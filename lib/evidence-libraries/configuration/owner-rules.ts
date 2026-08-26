import {
  type ValidationIssue,
  validateSectionStructure,
} from "./generated-validation";
import {
  REQUIRED_OWNER_SECTION_KEYS,
  type SectionKey,
} from "./section-registry";

export type OwnerSectionRow = { sectionKey: SectionKey; payload: unknown };

export type OwnerRuleOptions = {
  // The public address the platform reserved for this library.
  expectedBaseUrl?: string;
  // When true, every section the schema requires must be present.
  requireComplete?: boolean;
};

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// Rules the runtime schema cannot express. Everything else comes from the
// generated per-section validators.
function ownerRuleIssues(
  sectionKey: SectionKey,
  payload: unknown,
  options: OwnerRuleOptions,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const record = objectValue(payload);
  if (
    sectionKey === "identity" &&
    options.expectedBaseUrl !== undefined &&
    typeof record?.baseUrl === "string" &&
    record.baseUrl !== options.expectedBaseUrl
  ) {
    issues.push({
      pointer: "/identity/baseUrl",
      section: "identity",
      keyword: "platformAddress",
      message: "The generated public address cannot be changed.",
    });
  }
  // There is no plan model yet. Every library counts as a free plan, so the
  // "Powered by OpenScholar" footer credit stays on. Plan gating comes later.
  if (sectionKey === "footer" && record?.poweredBy === false) {
    issues.push({
      pointer: "/footer/poweredBy",
      section: "footer",
      keyword: "plan",
      message: "Available on paid plans.",
    });
  }
  return issues;
}

export function validateOwnerSection(
  sectionKey: SectionKey,
  payload: unknown,
  options: OwnerRuleOptions = {},
): { valid: boolean; issues: ValidationIssue[] } {
  const issues = [
    ...validateSectionStructure(sectionKey, payload).issues,
    ...ownerRuleIssues(sectionKey, payload, options),
  ];
  return { valid: issues.length === 0, issues };
}

export function validateOwnerSections(
  rows: readonly OwnerSectionRow[],
  options: OwnerRuleOptions = {},
): { valid: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const seen = new Set<SectionKey>();
  for (const row of rows) {
    if (seen.has(row.sectionKey)) {
      issues.push({
        pointer: `/${row.sectionKey}`,
        section: row.sectionKey,
        keyword: "duplicate",
        message: "Section appears more than once.",
      });
      continue;
    }
    seen.add(row.sectionKey);
    issues.push(...validateOwnerSection(row.sectionKey, row.payload, options).issues);
  }
  if (options.requireComplete) {
    for (const sectionKey of REQUIRED_OWNER_SECTION_KEYS) {
      if (seen.has(sectionKey)) continue;
      issues.push({
        pointer: `/${sectionKey}`,
        section: sectionKey,
        keyword: "required",
        message: "Required section is missing.",
      });
    }
  }
  return { valid: issues.length === 0, issues };
}
