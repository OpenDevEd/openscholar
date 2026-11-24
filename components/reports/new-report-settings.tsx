"use client";

// Settings > Admin > Publishing: whether new reports are open, between which dates, and how many activations each
// period takes. MOCK (mock/new-report-limits): saved in this browser (lib/reports/intake.ts), so the Publish page in
// another tab follows it.

import { useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Ban, CalendarClock, CircleCheck, Clock3, Gauge, Globe2, Hourglass, Plus, TimerReset, Trash2 } from "@/components/icons";
import { LIST, Segmented, Zone } from "@/components/settings/parts";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { TimezonePicker } from "@/components/evidence-libraries/configuration/sections/notifications-fields";
import { FieldMessage } from "@/components/reports/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipHint } from "@/components/ui/tooltip";
import { SEEDED, fromLocalInput, saveIntake, stateOf, toLocalInput, usesOf, useIntake, useNow, type Intake, type IntakeState, type Limit, type LimitUse, type Period } from "@/lib/reports/intake";
import { cn } from "@/lib/utils";

/** A date and time as the admin reads it, in the timezone the settings use. */
function useWhen(timeZone: string) {
  const format = useFormatter();
  return (at: number) => format.dateTime(at, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
}

export function NewReportSettings() {
  const t = useTranslations("publishReports.settings.intake");
  const intake = useIntake();
  const now = useNow();
  const state = stateOf(intake, now);
  const when = useWhen(intake.timezone);
  const set = (patch: Partial<Intake>) => saveIntake({ ...intake, ...patch });
  const setLimit = (id: string, patch: Partial<Limit>) => set({ limits: intake.limits.map((limit) => (limit.id === id ? { ...limit, ...patch } : limit)) });
  const add = () => {
    // The first limit is the one most need: the whole time open between dates, or a week. Another is most often a day.
    const period: Period = intake.limits.length ? "day" : intake.mode === "dates" ? "window" : "week";
    set({ limits: [...intake.limits, { id: crypto.randomUUID(), count: 1000, period, reset: "calendar", used: SEEDED[period] }] });
  };
  // The timezone matters only where something is read on a clock: the dates, or a period that starts at midnight.
  const clocked = intake.mode === "dates" || intake.limits.some((limit) => limit.period !== "window" && limit.reset === "calendar");
  const uses = usesOf(intake, now);

  return (
    <Zone label={t("title")} aside={<StateChip state={state} when={when} closesAt={intake.mode === "dates" ? intake.closesAt : null} />}>
      <ul className={LIST}>
        <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3.5">
          <span className="min-w-0 basis-64 flex-1">
            <span className="block text-sm font-medium">{t("when")}</span>
            <span className="block text-xs text-muted-foreground">{t(`hint.${intake.mode}`)}</span>
          </span>
          <Segmented
            label={t("when")}
            value={intake.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { id: "off", label: t("mode.off"), icon: Ban },
              { id: "on", label: t("mode.on"), icon: CircleCheck },
              { id: "dates", label: t("mode.dates"), icon: CalendarClock },
            ]}
          />
        </li>
        {intake.mode === "dates" ? <DatesRow intake={intake} now={now} onChange={set} /> : null}
        {clocked ? (
          <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5">
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Globe2 className="size-4 text-muted-foreground" />
                {t("timezone")}
              </span>
              <span className="block text-xs text-muted-foreground">{t("timezoneHint")}</span>
            </span>
            <span className="w-full sm:w-64">
              <TimezonePicker id="intake-timezone" invalid={false} value={intake.timezone} onChange={(timezone) => set({ timezone })} />
            </span>
          </li>
        ) : null}
      </ul>

      <div className="space-y-2.5 pt-3">
        <div className="flex min-h-7 items-center justify-between gap-3 ps-1">
          <h3 className="text-xs font-medium text-muted-foreground">{t("limits")}</h3>
          <Button size="sm" variant="outline" onClick={add}>
            <Plus /> {t("addLimit")}
          </Button>
        </div>
        <ul className={LIST}>
          {intake.limits.length ? (
            intake.limits.map((limit) => (
              <LimitRow key={limit.id} use={uses.find((use) => use.id === limit.id)!} dates={intake.mode === "dates"} when={when} onChange={(patch) => setLimit(limit.id, patch)} onRemove={() => set({ limits: intake.limits.filter((kept) => kept.id !== limit.id) })} />
            ))
          ) : (
            <li className="flex items-center gap-3 px-4 py-3.5 text-sm text-muted-foreground">
              <Gauge className="size-4 shrink-0" />
              {t("noLimits")}
            </li>
          )}
        </ul>
        <p className="ps-1 text-xs text-muted-foreground">{t("limitsHint")}</p>
      </div>
    </Zone>
  );
}

/** Where new reports stand, beside the heading. */
function StateChip({ state, when, closesAt }: { state: IntakeState; when: (at: number) => string; closesAt: number | null }) {
  const t = useTranslations("publishReports.settings.intake.state");
  if (state.open) return <StatusChip tone="success" icon="tone">{closesAt === null ? t("open") : t("openUntil", { date: when(closesAt) })}</StatusChip>;
  if (state.why === "off") return <StatusChip tone="neutral" icon={Ban}>{t("off")}</StatusChip>;
  if (state.why === "notYet") return <StatusChip tone="neutral" icon={CalendarClock}>{t("opens", { date: when(state.at) })}</StatusChip>;
  if (state.why === "ended") return <StatusChip tone="neutral" icon={Hourglass}>{t("ended", { date: when(state.at) })}</StatusChip>;
  return <StatusChip tone="warning" icon="tone">{state.reopensAt === null ? t("full") : t("fullUntil", { date: when(state.reopensAt) })}</StatusChip>;
}

/** When new reports open and close, and where now is between them. */
function DatesRow({ intake, now, onChange }: { intake: Intake; now: number; onChange: (patch: Partial<Intake>) => void }) {
  const t = useTranslations("publishReports.settings.intake");
  const format = useFormatter();
  const id = useId();
  const { timezone } = intake;
  const [opens, setOpens] = useState(intake.opensAt === null ? "" : toLocalInput(intake.opensAt, timezone));
  const [closes, setCloses] = useState(intake.closesAt === null ? "" : toLocalInput(intake.closesAt, timezone));
  const opensAt = opens ? fromLocalInput(opens, timezone) : null;
  const closesAt = closes ? fromLocalInput(closes, timezone) : null;
  // A close still to come, and after the opening: anything else is said at the box and not saved.
  const closeWrong = closesAt === null ? null : closesAt <= now ? t("closePast") : opensAt !== null && closesAt <= opensAt ? t("closeBeforeOpen") : null;
  const commit = () => {
    if (!closeWrong) onChange({ opensAt, closesAt });
  };
  const start = opensAt ?? now;
  const span = closesAt !== null && closesAt > start ? closesAt - start : null;
  const through = span === null ? 0 : Math.min(1, Math.max(0, (now - start) / span));
  return (
    <li className="space-y-3 px-4 py-3.5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1.5" htmlFor={`${id}-opens`}>
          <span className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="size-4 text-muted-foreground" />
            {t("opens")}
          </span>
          <Input id={`${id}-opens`} type="datetime-local" value={opens} onChange={(event) => setOpens(event.target.value)} onBlur={commit} />
          <span className="block ps-1 text-xs text-muted-foreground">{t("opensHint")}</span>
        </label>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-closes`} className="flex items-center gap-2 text-sm font-medium">
            <Hourglass className="size-4 text-muted-foreground" />
            {t("closes")}
          </label>
          <Input
            id={`${id}-closes`}
            type="datetime-local"
            min={toLocalInput(now, timezone)}
            value={closes}
            onChange={(event) => setCloses(event.target.value)}
            onBlur={commit}
            aria-invalid={closeWrong ? true : undefined}
            aria-describedby={closeWrong ? `${id}-closes-error` : `${id}-closes-hint`}
          />
          {closeWrong ? <FieldMessage id={`${id}-closes-error`}>{closeWrong}</FieldMessage> : <span id={`${id}-closes-hint`} className="block ps-1 text-xs text-muted-foreground">{t("closesHint")}</span>}
        </div>
      </div>
      {/* Where now is between the two: a track that fills as the time runs. */}
      {span !== null && !closeWrong ? (
        <div className="space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${through * 100}%` }} />
          </div>
          <div className="flex items-center justify-between gap-3 text-xs tabular-nums text-muted-foreground">
            <span>{format.dateTime(start, { day: "numeric", month: "short", timeZone: timezone })}</span>
            <span className="flex items-center gap-1.5">
              <Clock3 className="size-3.5" />
              {now < start ? t("startsIn", { time: format.relativeTime(start, now) }) : now >= closesAt! ? t("over") : t("left", { time: format.relativeTime(closesAt!, now) })}
            </span>
            <span>{format.dateTime(closesAt!, { day: "numeric", month: "short", timeZone: timezone })}</span>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** One limit: how many activations, in what period, counted how, and how far through it is. */
function LimitRow({ use, dates, when, onChange, onRemove }: { use: LimitUse; /** New reports open between dates: "in total" is while they are. */ dates: boolean; when: (at: number) => string; onChange: (patch: Partial<Limit>) => void; onRemove: () => void }) {
  const t = useTranslations("publishReports.settings.intake");
  const format = useFormatter();
  const id = useId();
  const [count, setCount] = useState(String(use.count));
  const wrong = !/^\d+$/.test(count.trim()) || Number(count) < 1 ? t("countWrong") : null;
  const commit = () => {
    if (!wrong && Number(count) !== use.count) onChange({ count: Number(count) });
  };
  const share = Math.min(1, use.used / use.count);
  return (
    <li className="space-y-3 px-4 py-3.5">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Input
            id={`${id}-count`}
            inputMode="numeric"
            aria-label={t("countLabel")}
            value={count}
            onChange={(event) => setCount(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            aria-invalid={wrong ? true : undefined}
            aria-describedby={wrong ? `${id}-count-error` : undefined}
            className="h-8 w-24 text-end tabular-nums"
          />
          <span className="text-sm">{t("activations", { count: Number(count) || 0 })}</span>
          <Select value={use.period} onValueChange={(period) => onChange({ period: period as Period, used: SEEDED[period as Period] })}>
            <SelectTrigger size="sm" aria-label={t("periodLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">{t("period.day")}</SelectItem>
              <SelectItem value="week">{t("period.week")}</SelectItem>
              <SelectItem value="month">{t("period.month")}</SelectItem>
              <SelectItem value="window">{t(dates ? "period.dates" : "period.total")}</SelectItem>
            </SelectContent>
          </Select>
          {use.period === "window" ? null : (
            <Segmented
              label={t("resetLabel")}
              value={use.reset}
              onChange={(reset) => onChange({ reset })}
              options={[
                { id: "rolling", label: t(`rolling.${use.period}`), icon: TimerReset },
                { id: "calendar", label: t(`calendar.${use.period}`), icon: CalendarClock },
              ]}
            />
          )}
        </div>
        <TooltipHint label={t("remove")}>
          <Button variant="ghost" size="icon" aria-label={t("remove")} className="size-8 shrink-0 text-muted-foreground" onClick={onRemove}>
            <Trash2 />
          </Button>
        </TooltipHint>
      </div>
      {wrong ? <FieldMessage id={`${id}-count-error`} className="-mt-1.5">{wrong}</FieldMessage> : null}
      {/* How much of this period it has taken, as a meter, with when the count starts again. */}
      <div className="space-y-1.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={use.count} aria-valuenow={use.used} aria-label={t("usedLabel")}>
          <div className={cn("h-full rounded-full transition-[width] duration-500", use.full ? "bg-warning" : "bg-primary")} style={{ width: `${share * 100}%` }} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("used", { used: format.number(Math.min(use.used, use.count)), count: format.number(use.count) })}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {use.full ? <StatusChip tone="warning" icon="tone">{t("full")}</StatusChip> : null}
            {use.resetsAt !== null ? (
              <StatusChip tone="neutral" icon={use.reset === "calendar" ? CalendarClock : TimerReset}>
                {t(use.reset === "calendar" ? "startsAgain" : "frees", { date: when(use.resetsAt) })}
              </StatusChip>
            ) : (
              <StatusChip tone="neutral" icon={Hourglass}>
                {t(dates ? "untilClose" : "sinceOpen")}
              </StatusChip>
            )}
          </span>
        </div>
      </div>
    </li>
  );
}
