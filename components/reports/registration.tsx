"use client";

// Where a live report's registrations stand. A report registers as a community's record does: its file is archived
// on Zenodo, and with Crossref on its DOI is registered there, one after the other.

import { useTranslations } from "next-intl";
import { StatusChip, type StatusTone } from "@/components/evidence-libraries/configuration/status-chip";
import { stepsOf, type RegistrationStep } from "@/lib/reports/report";
import { DocidChip } from "@/components/reports/docid-identifier";

type Registered = Parameters<typeof stepsOf>[0];

const TONE: Record<RegistrationStep["state"], StatusTone> = { waiting: "neutral", working: "running", done: "success", failed: "warning" };

export const PROVIDER_NAME: Record<RegistrationStep["provider"], string> = { zenodo: "Zenodo", crossref: "Crossref" };

/** What a registration step says. A withdrawn report's registrars hold its record marked withdrawn: its DOI can't be removed. */
export function useStepWords() {
  const t = useTranslations("publishReports.registration");
  return (step: RegistrationStep, withdrawn = false) => t(`${step.provider}.${withdrawn && step.state === "done" ? "withdrawn" : step.state}`);
}
export const stepTone = (step: RegistrationStep) => TONE[step.state];

/** The one registration a row has room for: the one refused, else the one under way, else the last one done. */
export function standingOf(report: Registered): RegistrationStep {
  const steps = stepsOf(report);
  return steps.find((step) => step.state === "failed") ?? steps.find((step) => step.state !== "done") ?? steps.at(-1)!;
}

/**
 * Each registration as a chip, in the order they happen. `own` names whose Zenodo account holds its copy, when it is
 * the author's own: "Archived on Zenodo" alone left them unsure it went there.
 */
export function RegistrationChips({ report, withdrawn = false, own }: { report: Registered; withdrawn?: boolean; own?: "mine" | "signer" }) {
  const stepWords = useStepWords();
  const t = useTranslations("publishReports.registration");
  return (
    <>
      {stepsOf(report).map((step) => (
        <StatusChip key={step.provider} tone={withdrawn && step.state === "done" ? "neutral" : stepTone(step)} icon="tone">
          {own && step.provider === "zenodo" && step.state === "done" && !withdrawn ? t(own === "mine" ? "zenodo.doneMine" : "zenodo.doneSigner") : stepWords(step, withdrawn)}
        </StatusChip>
      ))}
      {/* MOCK (mock/identifier-services): its DOCiD's registration, once the others are done. */}
      {stepsOf(report).every((step) => step.state === "done") ? <DocidChip withdrawn={withdrawn} /> : null}
    </>
  );
}
