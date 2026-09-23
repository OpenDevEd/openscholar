import { aiProviderIssues, PLATFORM_FEATURE_KEYS } from "./ai";
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
  // Whether AI answers are on for this library, counting the rows being
  // saved. The AI provider entry has to agree with it.
  featuresAi?: boolean;
  // Current OpenScholar models available to Evidence Libraries.
  allowedAiModels?: ReadonlySet<string>;
  modelCatalogReady?: boolean;
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
  // The directory names everyone on the team. The platform fills it from the
  // team at assembly, so an owner row never carries one.
  if (
    sectionKey === "home" &&
    record?.directory !== undefined &&
    !(Array.isArray(record.directory) && record.directory.length === 0)
  ) {
    issues.push({
      pointer: "/home/directory",
      section: "home",
      keyword: "platformValue",
      message: "The team directory is set by the platform and cannot be saved.",
    });
  }
  // The platform decides these two switches and the search embedder. A saved
  // row must not carry them, or a stale value would sit in the draft while
  // the library runs on something else.
  if (sectionKey === "features") {
    for (const key of PLATFORM_FEATURE_KEYS) {
      if (record?.[key] !== undefined) {
        issues.push({
          pointer: `/features/${key}`,
          section: "features",
          keyword: "platformValue",
          message: "This is set by the platform and cannot be saved.",
        });
      }
    }
  }
  if (sectionKey === "search" && record?.embedder !== undefined) {
    issues.push({
      pointer: "/search/embedder",
      section: "search",
      keyword: "platformValue",
      message:
        "Search by meaning is set by the platform and cannot be saved.",
    });
  }
  // Reaching here means the row is being saved, so it must hold one provider.
  if (sectionKey === "ai") {
    issues.push(
      ...aiProviderIssues(
        record?.providers,
        options.featuresAi,
        true,
        options.allowedAiModels,
        options.modelCatalogReady,
      ),
    );
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
  // The AI provider entry has to agree with the AI answers switch, which
  // lives in another row. A caller that already knows the effective value
  // passes it; otherwise the `features` row in this set decides.
  const featuresRow = rows.find((row) => row.sectionKey === "features");
  const ruleOptions: OwnerRuleOptions = {
    ...options,
    featuresAi:
      options.featuresAi ??
      (featuresRow
        ? objectValue(featuresRow.payload)?.ai === true
        : undefined),
  };
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
    issues.push(
      ...validateOwnerSection(row.sectionKey, row.payload, ruleOptions).issues,
    );
  }
  // AI answers on with no AI row at all leaves the runtime without a
  // provider. Only the complete set can tell; a partial save has no `ai` row
  // simply because that card did not change.
  if (options.requireComplete && ruleOptions.featuresAi === true && !seen.has("ai")) {
    issues.push(
      ...aiProviderIssues(
        undefined,
        true,
        false,
        options.allowedAiModels,
        options.modelCatalogReady,
      ),
    );
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
