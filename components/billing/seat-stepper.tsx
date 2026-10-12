"use client";

// The seat count an organization buys on Team (#862): on the Pricing page's Team card and on its billing page.

import { useTranslations } from "next-intl";
import { Minus, Plus } from "@/components/icons";
import { Guarded } from "@/components/workspaces/parts";

/** `fewest` is as low as it goes, and `why` says why when that's above one: the seats in use. */
export function SeatStepper({ seats, fewest, why, onChange }: { seats: number; fewest: number; why: string | null; onChange: (seats: number) => void }) {
  const t = useTranslations("pricing.organizations");
  const fewer = (
    <button type="button" aria-label={t("oneSeatFewer")} disabled={seats <= fewest} onClick={() => onChange(seats - 1)} className="flex size-7 items-center justify-center rounded-full hover:bg-muted disabled:opacity-40">
      <Minus className="size-3.5" />
    </button>
  );
  return (
    <div className="flex items-center rounded-full bg-inset p-1">
      {seats <= fewest && why ? <Guarded reason={why}>{fewer}</Guarded> : fewer}
      <span className="min-w-16 whitespace-nowrap px-1 text-center text-sm font-semibold tabular-nums">{t("seats", { count: seats })}</span>
      <button type="button" aria-label={t("oneSeatMore")} onClick={() => onChange(seats + 1)} className="flex size-7 items-center justify-center rounded-full hover:bg-muted">
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
