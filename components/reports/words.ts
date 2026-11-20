"use client";

// Names a report's details store in English, in the reader's language: CRediT's roles, people's roles and the kinds of link.
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import type { CREDIT_ROLES, PersonKind, RelationKind } from "@/lib/reports/report";
import { DEFAULT_CHECKS } from "@/lib/reports/settings";

const ROLE_KEY = {
  Conceptualization: "conceptualization", "Data curation": "dataCuration", "Formal analysis": "formalAnalysis", "Funding acquisition": "fundingAcquisition",
  Investigation: "investigation", Methodology: "methodology", "Project administration": "projectAdministration", Resources: "resources", Software: "software",
  Supervision: "supervision", Validation: "validation", Visualization: "visualization", "Writing, original draft": "writingOriginalDraft", "Writing, review and editing": "writingReviewEditing",
} as const satisfies Record<(typeof CREDIT_ROLES)[number], string>;

/** A CRediT role's name. A role the list doesn't hold keeps its own words. */
export function useRoleName() {
  const t = useTranslations("publishReports.roles");
  return (role: string) => (Object.hasOwn(ROLE_KEY, role) ? t(ROLE_KEY[role as keyof typeof ROLE_KEY]) : role);
}

/** A CRediT role in a line, shortened from its definition at credit.niso.org; none for a role the list doesn't hold. */
export function useRoleDetail() {
  const t = useTranslations("publishReports.roleDetails");
  return (role: string) => (Object.hasOwn(ROLE_KEY, role) ? t(ROLE_KEY[role as keyof typeof ROLE_KEY]) : undefined);
}

/** What a person is to a report, in Crossref's roles: author, editor, translator. */
export function useKindName() {
  const t = useTranslations("publishReports.kinds");
  return (kind: PersonKind) => t(kind);
}

/** A kind of link's name: data, code, another version, a supplement. */
export function useRelationName() {
  const t = useTranslations("publishReports.relationKinds");
  return (kind: RelationKind) => t(kind);
}

const CHANGE_KEY = {
  Title: "title", Subtitle: "subtitle", Type: "type", Language: "language", Date: "date", Authors: "authors", Abstract: "abstract", Topics: "topics",
  Keywords: "keywords", Goals: "goals", "Study designs": "studyDesigns", Places: "places", Funding: "funding", References: "references", Links: "links",
} as const;

/** A changed field's name, as `changesOf` (lib/reports/report.ts) names it in English for the emails and the record. */
export function useChangeLabel() {
  const t = useTranslations("publishReports.fields");
  return (label: string) => (Object.hasOwn(CHANGE_KEY, label) ? t(CHANGE_KEY[label as keyof typeof CHANGE_KEY]) : label);
}

/** Says a refusal in its own words, or in the page's when it has none. */
export function useFailed() {
  const t = useTranslations("publishReports.common");
  return (error: unknown) => void toast.error(getErrorMessage(error, t("failed")));
}

/** Advice a shipped check gave before, as it is now: "ask for a review" read wrong once the report was in review. */
const OLD_FIXES: Record<string, string> = { "If this is your own earlier publication, say so when you ask for a review.": DEFAULT_CHECKS.find((check) => check.id === "published")!.fix! };

type DefaultCheckId = "byline" | "published" | "harm" | "rights" | "research";

/**
 * A check's name and fix in the reader's language while they are still the words Openscholar ships them with (the
 * messages' `check.defaults`). Once an admin rewords them, they read as written. "Already published" is the name the
 * published check shipped with before it was renamed, kept by settings made then.
 */
export function useCheckWords() {
  const t = useTranslations("publishReports.flow");
  const name = (name: string) => {
    const shipped = DEFAULT_CHECKS.find((check) => check.name === name || (check.id === "published" && name === "Already published"));
    return shipped ? t(`check.defaults.${shipped.id as DefaultCheckId}.name`) : name;
  };
  /** A fix as a result keeps it, its byline or licence already filled in: that is carried into the translated words. */
  const fix = (shown: string) => {
    // Advice a check shipped with before it was reworded, kept by settings and results made then.
    const fix = OLD_FIXES[shown] ?? shown;
    for (const check of DEFAULT_CHECKS) {
      if (!check.fix) continue;
      const hole = /\{(?:byline|licence)\}/.exec(check.fix)?.[0];
      const [before = "", after = ""] = hole ? check.fix.split(hole) : [check.fix];
      const same = hole ? fix.startsWith(before) && fix.endsWith(after) : fix === check.fix;
      const filled = hole ? fix.slice(before.length, fix.length - after.length) : "";
      if (same) return t(`check.defaults.${check.id as DefaultCheckId}.fix`, { byline: filled, licence: filled });
    }
    return fix;
  };
  return { name, fix };
}
