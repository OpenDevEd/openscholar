"use client";

// Who gets a report's PDF, under the licence it is published under (#1467): the choices follow the licence. Under one
// that lets anyone share the report: anyone, nobody but the people who can change it, or anyone from a date. Under the
// author's own that doesn't: Openscholar's readers, or nobody but those people. Zenodo keeps the file private whenever
// it isn't anyone's.

import { useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { fileAccessModes, fileAccessOf, isCalendarDay, licenceOpen, utcDay, type FileAccess, type Licence } from "@/lib/reports/report";
import { cn } from "@/lib/utils";
import { FieldMessage, useStepForm } from "@/components/reports/form";

/** A year from today, where an embargo starts when it is picked: changed in the date box under it. */
const aYearOn = () => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return utcDay(date);
};

/** The modes a live report's file may move to from `from`: only ever more open (`opensFurther`), and where it is now. */
const reachable = (from: FileAccess, mode: FileAccess["mode"]) =>
  mode === from.mode || (from.mode === "private" ? mode !== "private" : from.mode === "embargo" && mode === "open");

/** A day before `day` (YYYY-MM-DD). */
const dayBefore = (day: string) => utcDay(new Date(new Date(`${day}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000));
/** The first day an embargo can end on. */
const tomorrowDay = () => utcDay(new Date(Date.now() + 24 * 60 * 60 * 1000));

/**
 * What is wrong with an embargo's day: before tomorrow, or, for one a live report is under, not sooner than it ends.
 * The step that holds the choice stops its Next on it, and the field says it as it is typed.
 */
export const embargoProblem = (access: FileAccess, from: FileAccess | null = null): "past" | "notSooner" | null =>
  access.mode !== "embargo" ? null : !isCalendarDay(access.until) || access.until < tomorrowDay() ? "past" : from?.mode === "embargo" && access.until >= from.until ? "notSooner" : null;

export function FileAccessChoice({ licence, value, onChange, disabled = false, from = null, dateId }: { licence: Licence; /** The choice made, which the licence may not allow: then it gets the licence's own. */ value: FileAccess | null; onChange: (access: FileAccess) => void; disabled?: boolean; /** A live report's saved access, which it may only open further from: every other choice is off. */ from?: FileAccess | null; /** The embargo day's box, for the step's Next to take the person to. */ dateId?: string }) {
  const t = useTranslations("publishReports.flow.fileAccess");
  const format = useFormatter();
  const id = useId();
  const access = fileAccessOf(licence, value);
  const open = licenceOpen(licence);
  // The first day an embargo can end on, taken when the row opens.
  const [tomorrow] = useState(tomorrowDay);
  const date = dateId ?? `${id}-date`;
  const wrong = embargoProblem(access, from);
  const meaning =
    access.mode === "embargo" && wrong
      ? t("embargoBody")
      : access.mode === "embargo"
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
        // An embargo picked from one it is under starts on the day before it ends; otherwise a year on.
        onValueChange={(mode) => onChange(mode === "embargo" ? { mode, until: from?.mode === "embargo" ? dayBefore(from.until) : aYearOn() } : ({ mode } as FileAccess))}
        className={cn("grid-cols-1 gap-3", open ? "sm:grid-cols-3" : "sm:grid-cols-2")}
      >
        {fileAccessModes(licence).map((mode) => {
          const on = access.mode === mode;
          const off = disabled || (from !== null && !reachable(from, mode));
          return (
            <label key={mode} htmlFor={`${id}-${mode}`} className={cn("flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors", off ? "opacity-60" : "cursor-pointer", on ? "border-primary bg-primary/[0.06]" : cn("border-border", !off && "hover:border-foreground/25 hover:bg-muted/50"))}>
              <RadioGroupItem id={`${id}-${mode}`} value={mode} disabled={off} className="mt-0.5" />
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
          <div className="pt-3">
            <label htmlFor={date} className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">{t("opensOn")}</span>
              {/* What is typed is the choice, so the box and what is saved never differ: a day it can't be is said
                  under it, and the step goes no further until it is changed. */}
              <Input
                id={date}
                type="date"
                className="w-44"
                min={tomorrow}
                // An embargo it is under already may only end sooner.
                max={from?.mode === "embargo" ? dayBefore(from.until) : undefined}
                disabled={disabled}
                value={access.until}
                aria-invalid={wrong ? true : undefined}
                aria-describedby={wrong ? `${date}-error` : undefined}
                // Cleared or half typed, it is "" and kept so: the box never snaps back to a day the person changed.
                onChange={(event) => onChange({ mode: "embargo", until: event.currentTarget.value })}
              />
            </label>
            {wrong ? (
              <FieldMessage id={`${date}-error`}>
                {wrong === "past" ? t("untilPast") : t("untilNotSooner", { date: format.dateTime(new Date(`${(from as { until: string }).until}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" }) })}
              </FieldMessage>
            ) : null}
          </div>
        ) : null}
      </AutoHeight>
      <p className="text-sm text-pretty text-muted-foreground" aria-live="polite">
        {meaning}
      </p>
    </div>
  );
}

/**
 * Who gets a report's file, changed after signing: picked here, then confirmed, so a change is meant and the
 * registrars aren't sent one for every click. Live, the file only ever opens further, which the prompt says.
 */
export function FileAccessChange({ licence, saved, live, onSave, disabled = false }: { licence: Licence; saved: FileAccess; /** Readers may have had the file: it only opens further. */ live: boolean; onSave: (access: FileAccess) => Promise<unknown>; disabled?: boolean }) {
  const t = useTranslations("publishReports.flow.fileAccess");
  const [picked, setPicked] = useState<FileAccess | null>(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const date = useId();
  const { go } = useStepForm();
  const changed = picked !== null && JSON.stringify(fileAccessOf(licence, picked)) !== JSON.stringify(saved);
  const save = async () => {
    setSaving(true);
    try {
      await onSave(fileAccessOf(licence, picked));
      setPicked(null);
    } finally {
      setSaving(false);
      setAsking(false);
    }
  };
  return (
    <div className="space-y-3">
      <FileAccessChoice licence={licence} value={picked ?? saved} onChange={setPicked} disabled={disabled || saving} from={live ? saved : null} dateId={date} />
      {/* Live, it only opens further, said while it can: one already as open as its licence allows is told why it stops there. */}
      {live && (saved.mode === "private" || saved.mode === "embargo") ? <p className="text-xs text-pretty text-muted-foreground">{t("oneWay")}</p> : null}
      {live && saved.mode === "readers" ? <p className="text-xs text-pretty text-muted-foreground">{t("readersMost")}</p> : null}
      <AutoHeight>
        {changed ? (
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setPicked(null)}>
              {t("cancel")}
            </Button>
            {/* A day it can't be is said under its box: Save goes there rather than asking to confirm it. */}
            <Button type="button" size="sm" disabled={saving} onClick={() => go([!!embargoProblem(fileAccessOf(licence, picked), live ? saved : null) && date], () => setAsking(true))}>
              {t("save")}
            </Button>
          </div>
        ) : null}
      </AutoHeight>
      <AlertDialog open={asking} onOpenChange={(open) => !open && !saving && setAsking(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t(live ? "confirmLive" : "confirmBefore")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={(event) => (event.preventDefault(), void save())}>
              {t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
