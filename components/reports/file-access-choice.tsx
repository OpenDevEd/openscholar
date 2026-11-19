"use client";

// Who gets a report's PDF, under the licence it is published under (#1467): the choices follow the licence. Under one
// that lets anyone share the report: anyone, nobody but the people who can change it, or anyone from a date. Under the
// author's own that doesn't: Openscholar's readers, or nobody but those people. Zenodo keeps the file private whenever
// it isn't anyone's.

import { useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AutoHeight } from "@/components/ui/auto-height";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { fileAccessModes, fileAccessOf, licenceOpen, utcDay, type FileAccess, type Licence } from "@/lib/reports/report";
import { cn } from "@/lib/utils";

/** A year from today, where an embargo starts when it is picked: changed in the date box under it. */
const aYearOn = () => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return utcDay(date);
};

export function FileAccessChoice({ licence, value, onChange, disabled = false }: { licence: Licence; /** The choice made, which the licence may not allow: then it gets the licence's own. */ value: FileAccess | null; onChange: (access: FileAccess) => void; disabled?: boolean }) {
  const t = useTranslations("publishReports.flow.fileAccess");
  const format = useFormatter();
  const id = useId();
  const access = fileAccessOf(licence, value);
  const open = licenceOpen(licence);
  // The first day an embargo can end on, taken when the row opens.
  const [tomorrow] = useState(() => utcDay(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const meaning =
    access.mode === "embargo"
      ? t("meaning.embargo", { date: format.dateTime(new Date(`${access.until}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" }) })
      : t(access.mode === "private" && !open ? "meaning.privateClosed" : `meaning.${access.mode}`);
  return (
    <div className="space-y-3">
      <h3 id={`${id}-label`} className="text-sm font-semibold">
        {t("label")}
      </h3>
      <RadioGroup
        aria-labelledby={`${id}-label`}
        value={access.mode}
        disabled={disabled}
        onValueChange={(mode) => onChange(mode === "embargo" ? { mode, until: aYearOn() } : ({ mode } as FileAccess))}
        className={cn("grid-cols-1 gap-3", open ? "sm:grid-cols-3" : "sm:grid-cols-2")}
      >
        {fileAccessModes(licence).map((mode) => {
          const on = access.mode === mode;
          return (
            <label key={mode} htmlFor={`${id}-${mode}`} className={cn("flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors", disabled ? "opacity-60" : "cursor-pointer", on ? "border-primary bg-primary/[0.06]" : cn("border-border", !disabled && "hover:border-foreground/25 hover:bg-muted/50"))}>
              <RadioGroupItem id={`${id}-${mode}`} value={mode} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{t(mode)}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{t(`${mode}Body`)}</span>
              </span>
            </label>
          );
        })}
      </RadioGroup>
      {/* The day it opens, under the cards as it is picked; its top space is inside it, so closed it takes none. */}
      <AutoHeight className="!mt-0">
        {access.mode === "embargo" ? (
          <label className="flex items-center gap-3 pt-3 text-sm">
            <span className="text-muted-foreground">{t("opensOn")}</span>
            <Input
              type="date"
              className="w-44"
              min={tomorrow}
              disabled={disabled}
              // A new value from outside starts the box again from it.
              key={access.until}
              defaultValue={access.until}
              onBlur={(event) => {
                const until = event.currentTarget.value;
                if (until && until !== access.until && until >= tomorrow) onChange({ mode: "embargo", until });
              }}
            />
          </label>
        ) : null}
      </AutoHeight>
      <p className="text-sm text-pretty text-muted-foreground" aria-live="polite">
        {meaning}
      </p>
    </div>
  );
}
