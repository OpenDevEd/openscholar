"use client";

// Names a report's details store in English, in the reader's language: CRediT's roles and the kinds of link.
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import type { CREDIT_ROLES, RelationKind } from "@/lib/reports/report";

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
