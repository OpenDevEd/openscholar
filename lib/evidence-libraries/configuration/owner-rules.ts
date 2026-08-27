import {
  PLATFORM_MAIL_MISSING_MESSAGE,
  emailWantsPlatformMail,
} from "./assembly";
import {
  type ValidationIssue,
  validateSectionStructure,
} from "./generated-validation";
import { jsonPointerPatternMatches } from "./json-pointer";
import {
  PLATFORM_DEFAULT_POINTERS,
  REQUIRED_OWNER_SECTION_KEYS,
  type SectionKey,
  WRITE_ONLY_POINTER_PATTERNS,
  isPlatformSection,
} from "./section-registry";

// Drafts never carry keys or passwords; the platform adds them at assembly.
// A missing write-only value is therefore not a draft problem. The same goes
// for the logo and favicon, which the platform fills with its own brand.
function isMissingPlatformValue(issue: ValidationIssue): boolean {
  if (issue.keyword !== "required") return false;
  return (
    WRITE_ONLY_POINTER_PATTERNS.some((pattern) =>
      jsonPointerPatternMatches(pattern, issue.pointer),
    ) || (PLATFORM_DEFAULT_POINTERS as readonly string[]).includes(issue.pointer)
  );
}

export type OwnerSectionRow = { sectionKey: SectionKey; payload: unknown };

export type OwnerRuleOptions = {
  // The public address the platform reserved for this library.
  expectedBaseUrl?: string;
  // When true, every section the schema requires must be present.
  requireComplete?: boolean;
  // Whether the platform mail service exists. When false, recipients are
  // refused early instead of failing when the runtime starts.
  platformMailConfigured?: boolean;
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
  // The mail server is a platform service. Owners only pick recipients.
  if (sectionKey === "email" && record?.smtp !== undefined) {
    issues.push({
      pointer: "/email/smtp",
      section: "email",
      keyword: "platformValue",
      message: "The mail server is set by the platform and cannot be saved.",
    });
  }
  if (
    sectionKey === "email" &&
    options.platformMailConfigured === false &&
    emailWantsPlatformMail(record)
  ) {
    issues.push({
      pointer: "/email/smtp/host",
      section: "email",
      keyword: "platformMail",
      message: PLATFORM_MAIL_MISSING_MESSAGE,
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
    ...validateSectionStructure(sectionKey, payload).issues.filter(
      (issue) => !isMissingPlatformValue(issue),
    ),
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
    if (isPlatformSection(row.sectionKey)) {
      issues.push({
        pointer: `/${row.sectionKey}`,
        section: row.sectionKey,
        keyword: "platformSection",
        message: "This section is set by the platform and cannot be saved.",
      });
      continue;
    }
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
