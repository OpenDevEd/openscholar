// Whether new reports are open (Settings > Admin > Publishing, "New reports"): off, on, or on between two dates, with
// limits on how many reports are activated in a day, a week, a month or the whole time open. Convex refuses with it
// (convex/reports/intake.ts) and the Publish page says with it why a new report or a draft waits. Nothing here reads
// the clock: `now` is given, so a page works it out again as time passes and a query never goes stale.

export const INTAKE_MODES = ["off", "on", "dates"] as const;
/** How long a limit's count runs: a day, a week, a month, or the whole time new reports are open. */
export const PERIODS = ["day", "week", "month", "window"] as const;
/** Rolling counts the last 24 hours, 7 days or 30 days; calendar starts again at midnight, on Monday, or on the 1st. */
export const RESETS = ["rolling", "calendar"] as const;
export type Period = (typeof PERIODS)[number];
export type Reset = (typeof RESETS)[number];

/** The most limits, and the most activations one counts: the latest that many are read each time one is checked. */
export const LIMITS_MAX = 50;
export const LIMIT_COUNT_MAX = 5000;

export type Limit = { id: string; count: number; period: Period; reset: Reset };
export type Intake = {
  mode: (typeof INTAKE_MODES)[number];
  /** With `dates`: when new reports open (none is from `openedAt`) and close (none is never). */
  opensAt: number | null;
  closesAt: number | null;
  /** Where the dates and calendar periods are read. */
  timezone: string;
  limits: Limit[];
  /** When new reports were last switched on: where "in total" counts from when no opening date is set. */
  openedAt: number | null;
};

export const INTAKE_OFF: Intake = { mode: "off", opensAt: null, closesAt: null, timezone: "UTC", limits: [], openedAt: null };

const DAY = 24 * 3_600_000;
const ROLLING: Record<Exclude<Period, "window">, number> = { day: DAY, week: 7 * DAY, month: 30 * DAY };

/** The offset of a timezone from UTC at an instant, in milliseconds. */
function offsetAt(at: number, timeZone: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) * 60_000 : 0;
}

/**
 * A wall-clock time in a timezone as an instant. Month from 0; days past the month's end roll on. A time a clock
 * change skips (Santiago's midnight on its first day of summer time) is the first instant after the gap.
 */
export function zoned(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const guess = Date.UTC(year, month, day, hour, minute);
  // The instant under the offset before the change and under the one after: the wall clock reads `guess` at one of
  // them, or, in a gap, at neither, and the later one is where the skipped time lands.
  const first = guess - offsetAt(guess, timeZone);
  const candidates = [first, guess - offsetAt(first, timeZone)];
  const shows = candidates.filter((at) => at + offsetAt(at, timeZone) === guess);
  return shows.length ? Math.min(...shows) : Math.max(...candidates);
}

/** An instant as the wall clock in a timezone: month from 1, weekday from 0 on Sunday. */
function wall(at: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) };
}

/** Whether a timezone is one the clock knows. */
export function isTimezone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The midnight, Monday or 1st of the month that starts the calendar period `now` is in, in a timezone; `ahead` 1 is the next one. */
export function calendarStart(period: Exclude<Period, "window">, now: number, timeZone: string, ahead: 0 | 1 = 0) {
  const { year, month, day, weekday } = wall(now, timeZone);
  if (period === "day") return zoned(year, month - 1, day + ahead, 0, 0, timeZone);
  if (period === "week") return zoned(year, month - 1, day - ((weekday + 6) % 7) + 7 * ahead, 0, 0, timeZone);
  return zoned(year, month - 1 + ahead, 1, 0, 0, timeZone);
}

/** A `datetime-local` box's value for an instant in a timezone, and back. */
export const toLocalInput = (at: number, timeZone: string) => {
  const { year, month, day, hour, minute } = wall(at, timeZone);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${year}-${two(month)}-${two(day)}T${two(hour)}:${two(minute)}`;
};
export const fromLocalInput = (value: string, timeZone: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  return match ? zoned(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), timeZone) : null;
};

/** Where "in total" counts from: the opening date, or when new reports were switched on. */
const windowStart = (intake: Intake) => (intake.mode === "dates" && intake.opensAt !== null ? intake.opensAt : (intake.openedAt ?? 0));

/** Whether an activation made at `at` counts in a limit's period at `now`: a rolling period leaves out its first instant, which is exactly 24 hours, 7 days or 30 days ago. */
function counts(limit: Limit, intake: Intake, at: number, now: number) {
  if (limit.period === "window") return at >= windowStart(intake);
  return limit.reset === "rolling" ? at > now - ROLLING[limit.period] : at >= calendarStart(limit.period, now, intake.timezone);
}

/**
 * Where a limit stands at `now`, from `nth`: when the activation that would fill it was made, counting back from the
 * latest (the `count`-th latest), or null with fewer than that ever. It is full while that one is in its period, and a
 * rolling one has a place again once that one leaves it.
 */
export function limitAt(limit: Limit, intake: Intake, nth: number | null, now: number) {
  const full = nth !== null && counts(limit, intake, nth, now);
  const startsAgain = limit.period === "window" ? null : limit.reset === "calendar" ? calendarStart(limit.period, now, intake.timezone, 1) : full ? nth! + ROLLING[limit.period] : null;
  return { full, startsAgain };
}

export type IntakeState =
  | { open: true }
  | { open: false; why: "off" }
  | { open: false; why: "notYet"; at: number }
  | { open: false; why: "ended"; at: number }
  | { open: false; why: "full"; /** When a place opens again; null when none will before new reports close, or ever. */ reopensAt: number | null };

/** Whether a new report can start and a draft go on at `now`, and why not. `nths` is each limit's `nth`, by its id. */
export function intakeAt(intake: Intake, nths: Record<string, number | null>, now: number): IntakeState {
  if (intake.mode === "off") return { open: false, why: "off" };
  if (intake.mode === "dates") {
    if (intake.opensAt !== null && now < intake.opensAt) return { open: false, why: "notYet", at: intake.opensAt };
    if (intake.closesAt !== null && now >= intake.closesAt) return { open: false, why: "ended", at: intake.closesAt };
  }
  const full = intake.limits.map((limit) => limitAt(limit, intake, nths[limit.id] ?? null, now)).filter((limit) => limit.full);
  if (!full.length) return { open: true };
  // Every full limit has to have a place again before a report can go on: the latest of them, or never.
  const reopensAt = full.some((limit) => limit.startsAgain === null) ? null : Math.max(...full.map((limit) => limit.startsAgain!));
  const closes = intake.mode === "dates" ? intake.closesAt : null;
  return { open: false, why: "full", reopensAt: reopensAt !== null && closes !== null && reopensAt >= closes ? null : reopensAt };
}

/** Each limit's `nth` from the times of the latest activations, newest first. */
export const nthsOf = (limits: Limit[], latest: number[]) => Object.fromEntries(limits.map((limit) => [limit.id, latest[limit.count - 1] ?? null]));

/** How many activations a limit has counted in the period `now` is in, from the latest activations, newest first. */
export function usedAt(limit: Limit, intake: Intake, latest: number[], now: number) {
  let used = 0;
  while (used < latest.length && counts(limit, intake, latest[used], now)) used++;
  return used;
}

/** What is wrong with intake settings an admin saves, in words for them; null when they can be kept. */
export function intakeProblem(intake: Intake, now: number, saved: Intake): string | null {
  if (!isTimezone(intake.timezone)) return "Pick a timezone from the list.";
  if (intake.limits.length > LIMITS_MAX) return `Keep to ${LIMITS_MAX} limits.`;
  if (intake.limits.some((limit) => !Number.isInteger(limit.count) || limit.count < 1 || limit.count > LIMIT_COUNT_MAX)) return `A limit is a whole number of activations, from 1 to ${LIMIT_COUNT_MAX.toLocaleString("en")}.`;
  if (new Set(intake.limits.map((limit) => limit.id)).size !== intake.limits.length) return "Each limit needs its own id.";
  if (intake.opensAt !== null && intake.closesAt !== null && intake.closesAt <= intake.opensAt) return "Pick a closing time after they open.";
  // A closing time already past is kept as it was saved, but a new one has to be still to come.
  if (intake.closesAt !== null && intake.closesAt !== saved.closesAt && intake.closesAt <= now) return "Pick a closing time still to come.";
  return null;
}
