"use client";

import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  type ConfigurationDraft,
  type PageSectionKey,
  type SectionRow,
  type SectionState,
  sectionChanged,
  sectionProblems,
  sectionState,
} from "@/lib/evidence-libraries/configuration/rules";
import { StatusChip, type StatusTone } from "./status-chip";
import { InlineNotice, SectionCard } from "./section-card";
import { ResetButton } from "./fields";

export type SectionProps = {
  draft: ConfigurationDraft;
  /** The rows last saved on the platform. */
  saved: readonly SectionRow[];
  /** Update the draft. Return a new draft; the passed draft is a fresh clone. */
  patch: (update: (draft: ConfigurationDraft) => ConfigurationDraft) => void;
  /** Copy one card's values back from the saved rows. */
  reset: (sectionKey: PageSectionKey) => void;
};

export const STATE_TONE: Record<SectionState, StatusTone> = {
  complete: "success",
  edited: "warning",
  attention: "danger",
};

/**
 * Card for one configuration section: id for the rail, state chip,
 * per-section reset, and a list of problems when something is wrong.
 */
export function SectionShell({
  sectionKey,
  icon,
  description,
  draft,
  saved,
  reset,
  children,
}: Pick<SectionProps, "draft" | "saved" | "reset"> & {
  sectionKey: PageSectionKey;
  icon: LucideIcon;
  description: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const state = sectionState(draft, saved, sectionKey);
  const problems = sectionProblems(draft, sectionKey);
  const changed = sectionChanged(draft, saved, sectionKey);
  return (
    <SectionCard
      id={`sec-${sectionKey}`}
      className="scroll-mt-40"
      icon={icon}
      title={t(`sections.${sectionKey}`)}
      description={description}
      aside={
        <span className="flex items-center gap-2">
          {changed ? <ResetButton onClick={() => reset(sectionKey)} /> : null}
          <StatusChip tone={STATE_TONE[state]} data-section-state={state}>
            {t(`sectionState.${state}`)}
          </StatusChip>
        </span>
      }
      data-section-state={state}
    >
      {problems.length > 0 ? (
        <InlineNotice tone="danger" data-problems>
          <ul className="list-disc space-y-0.5 pl-4">
            {problems.map((problem) => (
              <li key={problem}>{t(`problems.${problem}`)}</li>
            ))}
          </ul>
        </InlineNotice>
      ) : null}
      {children}
    </SectionCard>
  );
}
