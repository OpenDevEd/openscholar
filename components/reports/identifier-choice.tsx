"use client";

// The identifiers a report gets (plans/identifier-services), picked when it's signed. The services the series always
// uses are shown locked, saying why; the ones authors pick from can be ticked, each with what it adds to the price.

import { useId } from "react";
import { useTranslations } from "next-intl";
import { AutoHeight } from "@/components/ui/auto-height";
import { Checkbox } from "@/components/ui/checkbox";
import { TooltipHint } from "@/components/ui/tooltip";
import { Lock } from "@/components/icons";
import { ServiceMark } from "@/components/reports/identifier-settings";
import { SERVICE_IDS, chosenOf, citedOf, pickProblem, routeOf, withNeeded, type Identifiers, type ServiceId } from "@/lib/reports/identifiers";
import { useMoney } from "@/lib/hooks/use-money";
import { cn } from "@/lib/utils";

/** Whether the signing step shows the choice: something to pick, something that costs more, or a DOCiD to tell of. */
export const showsIdentifiers = (ids: Identifiers) => SERVICE_IDS.some((id) => ids.services[id].mode === "optional" || (ids.services[id].mode === "required" && ids.services[id].price > 0)) || ids.services.docid.mode !== "off";

/** The author's first pick: as few optional services as the rule asks for. */
export const firstPick = (ids: Identifiers): ServiceId[] => (ids.choose.min > 0 ? SERVICE_IDS.filter((id) => ids.services[id].mode === "optional").slice(0, ids.choose.min) : []);

/** What each service of the report's route adds to the price, for the bill: as signing fixes it and activation charges it. */
export function addOnLines(ids: Identifiers, picked: ServiceId[], ownArchive: boolean) {
  return chosenOf(routeOf(ids, picked, ownArchive)).flatMap((id) => (ids.services[id].price > 0 ? [{ id, price: ids.services[id].price }] : []));
}

export function IdentifierChoice({ ids, picked, onChange, id: fieldId, invalid = false, disabled = false }: { ids: Identifiers; picked: ServiceId[]; onChange: (picked: ServiceId[]) => void; /** The first box, for the step's Next to take the person to. */ id?: string; /** Sign was pressed with a pick that can't be signed. */ invalid?: boolean; disabled?: boolean }) {
  const t = useTranslations("publishReports.flow.identifiers");
  const money = useMoney();
  const label = useId();
  const all = withNeeded(ids, picked);
  const cited = citedOf(ids, picked);
  const problem = pickProblem(ids, picked);
  const shown = SERVICE_IDS.filter((service) => ids.services[service].mode !== "off");
  const one = ids.choose.max === 1;
  const isLocked = (service: ServiceId) => ids.services[service].mode === "required" || (service === "zenodo" && all.includes("crossref"));
  const firstBox = shown.find((service) => !isLocked(service));
  // Why a card can't be unticked, said on it when hovered: it looks locked, and this says what locked it.
  const lockedWhy = (service: ServiceId) => (service === "zenodo" && all.includes("crossref") ? t("zenodoTied") : t(`always_${service}`));
  const gives = (service: ServiceId) => (service === "zenodo" && !all.includes("crossref") ? t("gives_zenodoOwn") : t(`gives_${service}`));
  return (
    <div className="space-y-3">
      <h3 id={label} className="text-sm font-semibold">
        {t("title")}
      </h3>
      <div role="group" aria-labelledby={label} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {shown.map((service) => {
          const s = ids.services[service];
          const locked = isLocked(service);
          const on = all.includes(service);
          const card = (
            <label key={service} tabIndex={locked ? 0 : undefined} className={cn("flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors", locked ? "cursor-default border-border opacity-50" : disabled ? "cursor-default" : "cursor-pointer", !locked && (on ? "border-primary bg-primary/[0.06]" : cn("border-border", !disabled && "hover:border-foreground/25 hover:bg-muted/50")), invalid && !locked && "border-destructive")}>
              {locked ? (
                <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Checkbox
                  id={service === firstBox ? fieldId : undefined}
                  checked={on}
                  disabled={disabled}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid && fieldId ? `${fieldId}-error` : undefined}
                  onCheckedChange={(checked) => onChange(checked ? (one ? [service] : [...picked, service]) : picked.filter((p) => p !== service))}
                  className="mt-0.5"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex h-5 items-center gap-2">
                  <ServiceMark id={service} />
                  {cited === service ? <span className="ms-auto shrink-0 rounded bg-inset px-1.5 text-2xs text-muted-foreground">{t("inByline")}</span> : null}
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{gives(service)}</span>
                <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {locked ? <span>{t("included")}</span> : null}
                  {s.price > 0 ? (
                    <bdi dir="ltr" className="tabular-nums">
                      {locked ? money(s.price) : `+${money(s.price)}`}
                    </bdi>
                  ) : locked ? null : (
                    <span>{t("noExtra")}</span>
                  )}
                </span>
              </span>
            </label>
          );
          return locked ? (
            <TooltipHint key={service} label={lockedWhy(service)}>
              {card}
            </TooltipHint>
          ) : (
            card
          );
        })}
      </div>
      <AutoHeight className="!mt-0">
        {invalid && problem ? (
          <p id={fieldId ? `${fieldId}-error` : undefined} className="pt-2 text-xs text-destructive">
            {problem === "nothingPrinted" ? t("pickPrintable") : one ? t(problem === "tooFew" ? "pickOne" : "pickOnlyOne") : t(problem === "tooFew" ? "pickAtLeast" : "pickAtMost", { count: problem === "tooFew" ? ids.choose.min : ids.choose.max })}
          </p>
        ) : null}
      </AutoHeight>
    </div>
  );
}
