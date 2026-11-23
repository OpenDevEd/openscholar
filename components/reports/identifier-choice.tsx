"use client";

// The identifiers a report gets (plans/identifier-services), picked when it's signed: the services its publisher
// always uses are shown as included, and the ones authors pick from can be ticked, each with what it adds to the price.
// MOCK (mock/identifier-services): settings from this browser (identifiers-mock-store.ts), with English words.

import { useId } from "react";
import { AutoHeight } from "@/components/ui/auto-height";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, Lock } from "@/components/icons";
import { ServiceMark } from "@/components/reports/identifier-settings";
import { SERVICES, SERVICE_IDS, citedOf, pickProblem, withNeeded, type Identifiers, type ServiceId } from "@/lib/reports/identifiers";
import { useMoney } from "@/lib/hooks/use-money";
import { cn } from "@/lib/utils";

const PROBLEM = {
  tooFew: (ids: Identifiers) => (ids.choose.max === 1 ? "Pick one." : `Pick at least ${ids.choose.min}.`),
  tooMany: (ids: Identifiers) => (ids.choose.max === 1 ? "Pick only one." : `Pick at most ${ids.choose.max}.`),
  nothingPrinted: () => "Pick one that can be printed on the report.",
} as const;

const GIVES: Record<ServiceId, string> = {
  crossref: "A DOI, printed on the report",
  zenodo: "A permanent copy, under the report's DOI",
  docid: "A DOCiD, the Africa PID Alliance's Handle",
};

/** Whether the signing step shows the choice at all: something to pick, or something that costs more. */
export const showsIdentifiers = (ids: Identifiers) => SERVICE_IDS.some((id) => ids.services[id].mode === "optional" || (ids.services[id].mode === "required" && ids.services[id].price > 0) || (id === "docid" && ids.services[id].mode !== "off"));

export function IdentifierChoice({ ids, picked, onChange, id: fieldId, invalid = false, disabled = false }: { ids: Identifiers; picked: ServiceId[]; onChange: (picked: ServiceId[]) => void; /** The first box, for the step's Next to take the person to. */ id?: string; /** Sign was pressed with a pick that can't be signed. */ invalid?: boolean; disabled?: boolean }) {
  const money = useMoney();
  const label = useId();
  const all = withNeeded(ids, picked);
  const cited = citedOf(ids, picked);
  const problem = pickProblem(ids, picked);
  // Every service in use stays on screen whatever else is ticked: Zenodo keeps the copy of a Crossref DOI, or gives
  // the report its own DOI without one, and its card says which.
  const shown = SERVICE_IDS.filter((service) => ids.services[service].mode !== "off");
  const one = ids.choose.max === 1;
  const isLocked = (service: ServiceId) => ids.services[service].mode === "required" || (service === "zenodo" && all.includes("crossref"));
  const firstPick = shown.find((service) => !isLocked(service));
  return (
    <div className="space-y-3">
      <h3 id={label} className="text-sm font-semibold">Identifiers</h3>
      <div role="group" aria-labelledby={label} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {shown.map((service) => {
          const s = ids.services[service];
          const locked = isLocked(service);
          const on = all.includes(service);
          const boxId = service === firstPick ? fieldId : undefined;
          return (
            <label key={service} className={cn("flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors", locked || disabled ? "cursor-default" : "cursor-pointer", on ? "border-primary bg-primary/[0.06]" : cn("border-border", !disabled && !locked && "hover:border-foreground/25 hover:bg-muted/50"), invalid && !locked && "border-destructive")}>
              {locked ? (
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-primary text-primary-foreground">
                  <Check className="size-3" />
                </span>
              ) : (
                <Checkbox
                  id={boxId}
                  checked={on}
                  disabled={disabled}
                  aria-invalid={invalid || undefined}
                  onCheckedChange={(checked) => onChange(checked ? (one ? [service] : [...picked, service]) : picked.filter((p) => p !== service))}
                  className="mt-0.5"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex h-5 items-center gap-2">
                  <ServiceMark id={service} />
                  {cited === service ? <span className="ms-auto shrink-0 rounded bg-inset px-1.5 text-2xs text-muted-foreground">In the byline</span> : null}
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{service === "zenodo" && !all.includes("crossref") ? "A DOI from Zenodo, and a permanent copy" : GIVES[service]}</span>
                <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {locked ? <Lock className="size-3" /> : null}
                  {s.price > 0 ? <bdi dir="ltr" className="tabular-nums">+{money(s.price)}</bdi> : <span>{locked ? "Included" : "No extra cost"}</span>}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <AutoHeight className="!mt-0">
        {invalid && problem ? (
          <p id={fieldId ? `${fieldId}-error` : undefined} className="pt-2 text-xs text-destructive">
            {PROBLEM[problem](ids)}
          </p>
        ) : null}
      </AutoHeight>
    </div>
  );
}
