"use client";

// Where a live report's registrations stand. A report registers as a community's record does: its file is archived
// on Zenodo, and with Crossref on its DOI is registered there, one after the other.

import { StatusChip, type StatusTone } from "@/components/evidence-libraries/configuration/status-chip";
import { stepsOf, type RegistrationStep } from "@/lib/reports/report";

type Registered = Parameters<typeof stepsOf>[0];

const WORDS: Record<RegistrationStep["provider"], Record<RegistrationStep["state"], string>> = {
  zenodo: { waiting: "Zenodo archive next", working: "Archiving on Zenodo", done: "Archived on Zenodo", failed: "Zenodo refused it" },
  crossref: { waiting: "Crossref next", working: "Sending to Crossref", done: "Registered with Crossref", failed: "Crossref refused it" },
};
const TONE: Record<RegistrationStep["state"], StatusTone> = { waiting: "neutral", working: "running", done: "success", failed: "warning" };

/** A withdrawn report's registrars hold its record marked withdrawn: its DOI can't be removed. */
const WITHDRAWN: Record<RegistrationStep["provider"], string> = { zenodo: "Marked withdrawn on Zenodo", crossref: "Marked withdrawn at Crossref" };
export const PROVIDER_NAME: Record<RegistrationStep["provider"], string> = { zenodo: "Zenodo", crossref: "Crossref" };

export const stepWords = (step: RegistrationStep, withdrawn = false) => (withdrawn && step.state === "done" ? WITHDRAWN[step.provider] : WORDS[step.provider][step.state]);
export const stepTone = (step: RegistrationStep) => TONE[step.state];

/** The one registration a row has room for: the one refused, else the one under way, else the last one done. */
export function standingOf(report: Registered): RegistrationStep {
  const steps = stepsOf(report);
  return steps.find((step) => step.state === "failed") ?? steps.find((step) => step.state !== "done") ?? steps.at(-1)!;
}

/** Each registration as a chip, in the order they happen. */
export function RegistrationChips({ report, withdrawn = false }: { report: Registered; withdrawn?: boolean }) {
  return (
    <>
      {stepsOf(report).map((step) => (
        <StatusChip key={step.provider} tone={withdrawn && step.state === "done" ? "neutral" : stepTone(step)} icon="tone">
          {stepWords(step, withdrawn)}
        </StatusChip>
      ))}
    </>
  );
}
