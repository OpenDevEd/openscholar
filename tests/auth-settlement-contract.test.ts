import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const AUTH_SENSITIVE_FILES = [
  "components/Pricing.tsx",
  "app/extraction/[jobId]/page.tsx",
  "components/auth-button.tsx",
  "app/settings/billing/page.tsx",
] as const;

const DISALLOWED_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "subscription plan fallback with || free",
    pattern: /subscription\?\.plan\s*\|\|\s*["']free["']/,
  },
  {
    label: "subscription plan fallback with ?? free",
    pattern: /subscription\?\.plan\s*\?\?\s*["']free["']/,
  },
  {
    label: "subscription status fallback with || inactive",
    pattern: /subscription\?\.status\s*\|\|\s*["']inactive["']/,
  },
  {
    label: "subscription status fallback with ?? inactive",
    pattern: /subscription\?\.status\s*\?\?\s*["']inactive["']/,
  },
];

const SUBSCRIPTION_HOOK_FILES = [
  "components/Pricing.tsx",
  "components/auth-button.tsx",
  "app/settings/billing/page.tsx",
] as const;

const DISALLOWED_SUBSCRIPTION_QUERY_PATTERNS: Array<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: "direct optional subscription query usage",
    pattern: /useOptionalAuthQuery\(\s*api\.subscriptions\.queries\.getMy/,
  },
  {
    label: "direct protected subscription query usage",
    pattern: /useProtectedQuery\(\s*api\.subscriptions\.queries\.getMy/,
  },
];

const JOB_DETAIL_FILE = "app/extraction/[jobId]/page.tsx" as const;

const JOB_DETAIL_DISALLOWED_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "pre-settlement empty state render branch",
    pattern: /sortedPapers\.length\s*===\s*0\s*\?/,
  },
];

const JOB_DETAIL_REQUIRED_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "shared list render state helper usage",
    pattern: /getAuthSensitiveListRenderState/,
  },
  {
    label: "explicit loading branch based on settlement",
    pattern: /resultsRenderState === "loading"/,
  },
];

function readSource(relativeFilePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("auth settlement contract", () => {
  for (const relativeFilePath of AUTH_SENSITIVE_FILES) {
    it(`${relativeFilePath} has no pre-settlement subscription fallbacks`, () => {
      const source = readSource(relativeFilePath);

      for (const { label, pattern } of DISALLOWED_PATTERNS) {
        expect(source, `${relativeFilePath} violates: ${label}`).not.toMatch(
          pattern,
        );
      }
    });
  }

  for (const relativeFilePath of SUBSCRIPTION_HOOK_FILES) {
    it(`${relativeFilePath} uses the shared subscription readiness hook`, () => {
      const source = readSource(relativeFilePath);

      expect(source).toMatch(/useSubscriptionState/);
      for (const { label, pattern } of DISALLOWED_SUBSCRIPTION_QUERY_PATTERNS) {
        expect(source, `${relativeFilePath} violates: ${label}`).not.toMatch(
          pattern,
        );
      }
    });
  }

  it(`${JOB_DETAIL_FILE} defers empty states until settlement`, () => {
    const source = readSource(JOB_DETAIL_FILE);

    for (const { label, pattern } of JOB_DETAIL_REQUIRED_PATTERNS) {
      expect(source, `${JOB_DETAIL_FILE} missing: ${label}`).toMatch(pattern);
    }

    for (const { label, pattern } of JOB_DETAIL_DISALLOWED_PATTERNS) {
      expect(source, `${JOB_DETAIL_FILE} violates: ${label}`).not.toMatch(pattern);
    }
  });
});
