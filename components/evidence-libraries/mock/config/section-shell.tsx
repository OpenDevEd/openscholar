"use client";

import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  type LibraryConfig,
  type MockLibrary,
  type SectionKey,
  type SectionState,
  sectionChanged,
  sectionProblems,
  sectionState,
} from "@/lib/evidence-libraries/mock/data";
import { useEvidenceLibraryMockStore } from "@/lib/evidence-libraries/mock/store";
import { StatusChip, type StatusTone } from "../library-status-badge";
import { InlineNotice, SectionCard } from "../section-card";
import { ResetButton } from "./fields";

export type SectionProps = {
  library: MockLibrary;
  /** Update the draft. Return a new config; the passed draft is a fresh clone. */
  patch: (update: (draft: LibraryConfig) => LibraryConfig) => void;
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
  library,
  children,
  tone,
}: {
  sectionKey: SectionKey;
  icon: LucideIcon;
  description: ReactNode;
  library: MockLibrary;
  children: ReactNode;
  tone?: "default" | "danger";
}) {
  const t = useTranslations("evidenceLibraryMock.config");
  const reset = useEvidenceLibraryMockStore((s) => s.resetSection);
  const tracked = sectionKey !== "versions" && sectionKey !== "danger";
  const state = tracked ? sectionState(library, sectionKey) : null;
  const problems = tracked ? sectionProblems(library.draft, sectionKey) : [];
  const changed = tracked && sectionChanged(library, sectionKey);
  return (
    <SectionCard
      id={`sec-${sectionKey}`}
      className="scroll-mt-40"
      icon={icon}
      tone={tone}
      title={t(`sections.${sectionKey}`)}
      description={description}
      aside={
        <span className="flex items-center gap-2">
          {changed ? <ResetButton onClick={() => reset(library.id, sectionKey)} /> : null}
          {state ? (
            <StatusChip tone={STATE_TONE[state]} data-section-state={state}>
              {t(`sectionState.${state}`)}
            </StatusChip>
          ) : null}
        </span>
      }
      data-section-state={state ?? undefined}
    >
      {problems.length > 0 ? (
        <InlineNotice tone="danger" data-problems>
          <ul className="list-disc space-y-0.5 pl-4">
            {[...new Set(problems)].map((p) => (
              <li key={p}>{t(`problems.${p as "nameMissing"}`)}</li>
            ))}
          </ul>
        </InlineNotice>
      ) : null}
      {children}
    </SectionCard>
  );
}
