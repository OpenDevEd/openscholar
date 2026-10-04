"use client";

import type { AppIcon } from "@/components/icons";
import type { Id } from "@/convex/_generated/dataModel";
import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useContext } from "react";
import {
  type ConfigurationDraft,
  type PageSectionKey,
  type SaveRefusal,
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
  libraryId: Id<"evidenceLibraries">;
  draft: ConfigurationDraft;
  /** The rows last saved on the platform. */
  saved: readonly SectionRow[];
  /** Update the draft. Return a new draft; the passed draft is a fresh clone. */
  patch: (update: (draft: ConfigurationDraft) => ConfigurationDraft) => void;
  /** Copy one card's values back from the saved rows. */
  reset: (sectionKey: PageSectionKey) => void;
};

const SaveRefusalContext = createContext<SaveRefusal | null>(null);

/** Lets every card show a save the platform refused because of its own values. */
export function SaveRefusalProvider({
  refusal,
  children,
}: {
  refusal: SaveRefusal | null;
  children: ReactNode;
}) {
  return (
    <SaveRefusalContext.Provider value={refusal}>
      {children}
    </SaveRefusalContext.Provider>
  );
}

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
  icon: AppIcon;
  description: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const state = sectionState(draft, saved, sectionKey);
  const problems = sectionProblems(draft, sectionKey);
  const changed = sectionChanged(draft, saved, sectionKey);
  const refusal = useContext(SaveRefusalContext);
  const refused = refusal?.card === sectionKey ? refusal.message : null;
  return (
    <SectionCard
      id={`sec-${sectionKey}`}
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
      {refused ? (
        <InlineNotice
          tone="danger"
          role="alert"
          title={t("saveRefused")}
          data-save-refused
        >
          {refused}
        </InlineNotice>
      ) : null}
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
