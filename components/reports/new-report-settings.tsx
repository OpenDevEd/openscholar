"use client";

// Settings > Admin > Publishing: whether new reports are open, between which dates, and how many activations each
// period takes (lib/reports/intake.ts). Saved whole on each change (convex/reports/intake.ts `save`).

import { useId, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { Ban, CalendarClock, CircleCheck, Clock3, Gauge, Globe2, Hourglass, Plus, TimerReset, Trash2 } from "@/components/icons";
import { LIST, Segmented, Zone } from "@/components/settings/parts";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { TimezonePicker } from "@/components/evidence-libraries/configuration/sections/notifications-fields";
import { FieldMessage } from "@/components/reports/form";
import { useNow } from "@/components/reports/intake-notice";
import { useFailed } from "@/components/reports/words";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipHint } from "@/components/ui/tooltip";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { LIMITS_MAX, LIMIT_COUNT_MAX, fromLocalInput, intakeAt, limitAt, toLocalInput, type Intake, type IntakeState, type Limit, type Period } from "@/lib/reports/intake";
import { cn } from "@/lib/utils";

/** A date and time as the admin reads it, in the timezone the settings use. */
function useWhen(timeZone: string) {
  const format = useFormatter();
  return (at: number) => format.dateTime(at, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
}

type Admin = FunctionReturnType<typeof api.reports.intake.admin>;

/** What the section reads, asked where the page waits for its settings, so the section is there when the page is. */
export function useIntakeAdmin() {
  const now = useNow();
  // Counted to the minute: each minute asks again, and the last answer stays up until the next is in.
  const minute = Math.floor(now / 60_000) * 60_000;
  const { data } = useProtectedQuery(api.reports.intake.admin, { now: minute });
  const [held, setHeld] = useState<Admin | undefined>(undefined);
  if (data && data !== held) setHeld(data);
  const shown = data ?? held;
  return { data: shown, minute, now };
}

export function NewReportSettings({ data: { intake, uses }, minute, now }: { data: Admin; /** The minute the counts are for, which the query was asked with. */ minute: number; now: number }) {
  const t = useTranslations("publishReports.settings.intake");
  const failed = useFailed();
  const when = useWhen(intake.timezone);
  // A change shows at once and the server's answer follows; a refusal puts it back and says why.
  const save = useMutation(api.reports.intake.save).withOptimisticUpdate((store, asked) => {
    const shown = store.getQuery(api.reports.intake.admin, { now: minute });
    if (shown) store.setQuery(api.reports.intake.admin, { now: minute }, { ...shown, intake: { ...shown.intake, ...asked } });
  });
  // Only what changed is sent: the server keeps the rest as saved.
  const set = (patch: Partial<Omit<Intake, "openedAt">>) => void save(patch).catch(failed);
  const setLimit = (id: string, patch: Partial<Limit>) => set({ limits: intake.limits.map((limit) => (limit.id === id ? { ...limit, ...patch } : limit)) });
  const add = () => {
    // The first limit is the one most need: the whole time open between dates, or a week. Another is most often a day.
    const period: Period = intake.limits.length ? "day" : intake.mode === "dates" ? "window" : "week";
    set({ limits: [...intake.limits, { id: crypto.randomUUID(), count: 1000, period, reset: "calendar" }] });
  };
  const counted = (id: string) => uses.find((use) => use.id === id);
  const state = intakeAt(intake, Object.fromEntries(uses.map((use) => [use.id, use.nth])), now);
  // The timezone matters only where something is read on a clock: the dates, or a period that starts at midnight.
  const clocked = intake.mode === "dates" || intake.limits.some((limit) => limit.period !== "window" && limit.reset === "calendar");

  return (
    <Zone label={t("title")} aside={<StateChip state={state} when={when} closesAt={intake.mode === "dates" ? intake.closesAt : null} />}>
      <ul className={LIST}>
        <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3.5">
          <span className="min-w-0 flex-1 basis-64">
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
        {/* Keyed by what is saved, so a refused date goes back to it and a timezone changed reads the dates again. */}
        {intake.mode === "dates" ? <DatesRow key={`${intake.opensAt}-${intake.closesAt}-${intake.timezone}`} intake={intake} now={now} onChange={set} /> : null}
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
          <Button size="sm" variant="outline" disabled={intake.limits.length >= LIMITS_MAX} onClick={add}>
            <Plus /> {t("addLimit")}
          </Button>
        </div>
        <ul className={LIST}>
          {intake.limits.length ? (
            intake.limits.map((limit) => (
              <LimitRow
                key={limit.id}
                limit={limit}
                // A limit just added or changed has its count once the server answers.
                used={counted(limit.id)?.used ?? 0}
                {...limitAt(limit, intake, counted(limit.id)?.nth ?? null, now)}
                dates={intake.mode === "dates"}
                when={when}
                onChange={(patch) => setLimit(limit.id, patch)}
                onRemove={() => set({ limits: intake.limits.filter((kept) => kept.id !== limit.id) })}
              />
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
  // A new close still to come, and after the opening: anything else is said at the box and not saved.
  const closeWrong = closesAt === null ? null : closesAt !== intake.closesAt && closesAt <= now ? t("closePast") : opensAt !== null && closesAt <= opensAt ? t("closeBeforeOpen") : null;
  const commit = () => {
    if (!closeWrong && (opensAt !== intake.opensAt || closesAt !== intake.closesAt)) onChange({ opensAt, closesAt });
  };
  const start = intake.opensAt ?? intake.openedAt ?? now;
  const end = intake.closesAt;
  const span = end !== null && end > start ? end - start : null;
  const through = span === null ? 0 : Math.min(1, Math.max(0, (now - start) / span));
  return (
    <li className="space-y-3 px-4 py-3.5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-opens`} className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="size-4 text-muted-foreground" />
            {t("opens")}
          </label>
          <Input id={`${id}-opens`} type="datetime-local" value={opens} onChange={(event) => setOpens(event.target.value)} onBlur={commit} aria-describedby={`${id}-opens-hint`} />
          <span id={`${id}-opens-hint`} className="block ps-1 text-xs text-muted-foreground">
            {t("opensHint")}
          </span>
        </div>
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
          {closeWrong ? (
            <FieldMessage id={`${id}-closes-error`}>{closeWrong}</FieldMessage>
          ) : (
            <span id={`${id}-closes-hint`} className="block ps-1 text-xs text-muted-foreground">
              {t("closesHint")}
            </span>
          )}
        </div>
      </div>
      {/* Where now is between the two, as saved: a track that fills as the time runs. */}
      {span !== null ? (
        <div className="space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${through * 100}%` }} />
          </div>
          <div className="flex items-center justify-between gap-3 text-xs tabular-nums text-muted-foreground">
            <span>{format.dateTime(start, { day: "numeric", month: "short", timeZone: timezone })}</span>
            <span className="flex items-center gap-1.5">
              <Clock3 className="size-3.5" />
              {now < start ? t("startsIn", { time: format.relativeTime(start, now) }) : now >= end! ? t("over") : t("left", { time: format.relativeTime(end!, now) })}
            </span>
            <span>{format.dateTime(end!, { day: "numeric", month: "short", timeZone: timezone })}</span>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** One limit: how many activations, in what period, counted how, and how far through it is. */
function LimitRow({ limit, used, full, startsAgain, dates, when, onChange, onRemove }: { limit: Limit; /** Activations counted in the period now. */ used: number; full: boolean; /** When its count starts again, or a rolling one has a place again; null when it doesn't. */ startsAgain: number | null; /** New reports open between dates: "in total" is while they are. */ dates: boolean; when: (at: number) => string; onChange: (patch: Partial<Limit>) => void; onRemove: () => void }) {
  const t = useTranslations("publishReports.settings.intake");
  const format = useFormatter();
  const id = useId();
  const [count, setCount] = useState(String(limit.count));
  const [was, setWas] = useState(limit.count);
  // A count saved from elsewhere, or put back after a refusal, replaces the box unless something else is being typed.
  if (limit.count !== was) {
    setWas(limit.count);
    if (Number(count) === was) setCount(String(limit.count));
  }
  const typed = Number(count.trim());
  const wrong = !/^\d+$/.test(count.trim()) || typed < 1 || typed > LIMIT_COUNT_MAX ? t("countWrong", { max: format.number(LIMIT_COUNT_MAX) }) : null;
  const commit = () => {
    if (!wrong && typed !== limit.count) onChange({ count: typed });
  };
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
          <span className="text-sm">{t("activations", { count: wrong ? limit.count : typed })}</span>
          <Select value={limit.period} onValueChange={(period) => onChange({ period: period as Period })}>
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
          {limit.period === "window" ? null : (
            <Segmented
              label={t("resetLabel")}
              value={limit.reset}
              onChange={(reset) => onChange({ reset })}
              options={[
                { id: "rolling", label: t(`rolling.${limit.period}`), icon: TimerReset },
                { id: "calendar", label: t(`calendar.${limit.period}`), icon: CalendarClock },
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
      {wrong ? (
        <FieldMessage id={`${id}-count-error`} className="-mt-1.5">
          {wrong}
        </FieldMessage>
      ) : null}
      {/* How much of this period it has taken, as a meter, with when the count starts again. */}
      <div className="space-y-1.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={limit.count} aria-valuenow={Math.min(used, limit.count)} aria-label={t("usedLabel")}>
          <div className={cn("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", full ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(1, used / limit.count) * 100}%` }} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span className="text-xs tabular-nums text-muted-foreground">{t("used", { used: format.number(Math.min(used, limit.count)), count: format.number(limit.count) })}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            {full ? (
              <StatusChip tone="warning" icon="tone">
                {t("full")}
              </StatusChip>
            ) : null}
            {limit.period === "window" ? (
              <StatusChip tone="neutral" icon={Hourglass}>
                {t(dates ? "untilClose" : "sinceOpen")}
              </StatusChip>
            ) : startsAgain !== null ? (
              <StatusChip tone="neutral" icon={limit.reset === "calendar" ? CalendarClock : TimerReset}>
                {t(limit.reset === "calendar" ? "startsAgain" : "frees", { date: when(startsAgain) })}
              </StatusChip>
            ) : null}
          </span>
        </div>
      </div>
    </li>
  );
}
