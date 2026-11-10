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

export const stepWords = (step: RegistrationStep) => WORDS[step.provider][step.state];
export const stepTone = (step: RegistrationStep) => TONE[step.state];

/** The one registration a row has room for: the one refused, else the one under way, else the last one done. */
export function standingOf(report: Registered): RegistrationStep {
  const steps = stepsOf(report);
  return steps.find((step) => step.state === "failed") ?? steps.find((step) => step.state !== "done") ?? steps.at(-1)!;
}

/** Each registration as a chip, in the order they happen. */
export function RegistrationChips({ report }: { report: Registered }) {
  return (
    <>
      {stepsOf(report).map((step) => (
        <StatusChip key={step.provider} tone={stepTone(step)} icon="tone">
          {stepWords(step)}
        </StatusChip>
      ))}
    </>
  );
}
