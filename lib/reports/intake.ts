"use client";

// MOCK (mock/new-report-limits): whether new reports are open, held in this browser so the admin page and the
// Publish page agree without a server change. The real build keeps this on `reportSettings` and counts activations
// from `reportActivations`; `stateOf` and the calendar sums are what it would keep.

import { useSyncExternalStore } from "react";

/** How long a limit's count runs: a day, a week, a month, or the whole time new reports are open. */
export type Period = "day" | "week" | "month" | "window";
/** Rolling counts the last day, week or month up to now; calendar starts again at midnight, on Monday, or on the 1st. */
export type Reset = "rolling" | "calendar";
export type Limit = { id: string; count: number; period: Period; reset: Reset; /** MOCK: activations already counted in its period. */ used: number };
export type Intake = {
  mode: "off" | "on" | "dates";
  /** With `dates`: when new reports open (none is at once) and close (none is never). */
  opensAt: number | null;
  closesAt: number | null;
  /** Where the dates and calendar periods are read. */
  timezone: string;
  limits: Limit[];
};

export type LimitUse = Limit & { full: boolean; /** When its count starts again; null for the whole time open. */ resetsAt: number | null };
export type IntakeState =
  | { open: true; uses: LimitUse[] }
  | { open: false; why: "off" }
  | { open: false; why: "notYet"; at: number }
  | { open: false; why: "ended"; at: number }
  | { open: false; why: "full"; uses: LimitUse[]; /** When the next period starts; null when none will. */ reopensAt: number | null };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The offset of a timezone from UTC at an instant, in milliseconds. */
function offsetAt(at: number, timeZone: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) * 60_000 : 0;
}

/** A wall-clock time in a timezone as an instant. Month from 0; days past the month's end roll on. */
export function zoned(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const guess = Date.UTC(year, month, day, hour, minute);
  return guess - offsetAt(guess - offsetAt(guess, timeZone), timeZone);
}

/** An instant as the wall clock in a timezone: month from 1, weekday from 0 on Sunday. */
function wall(at: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) };
}

/** The next midnight, Monday or 1st of the month in a timezone. */
export function nextCalendarStart(period: "day" | "week" | "month", now: number, timeZone: string) {
  const { year, month, day, weekday } = wall(now, timeZone);
  if (period === "day") return zoned(year, month - 1, day + 1, 0, 0, timeZone);
  if (period === "week") return zoned(year, month - 1, day + ((8 - weekday) % 7 || 7), 0, 0, timeZone);
  return zoned(year, month, 1, 0, 0, timeZone);
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

/** MOCK: activations a new limit starts with, so each period shows a believable count. */
export const SEEDED: Record<Period, number> = { day: 37, week: 180, month: 640, window: 412 };
/** MOCK: when a rolling count frees its first place: the oldest activation in it leaving the period. */
const ROLLING_FREES: Record<Exclude<Period, "window">, number> = { day: 5 * HOUR, week: 2 * DAY + 3 * HOUR, month: 9 * DAY };

/** Each limit with how far through its period it is, and when its count starts again. */
export function usesOf(intake: Intake, now: number): LimitUse[] {
  const hour = Math.ceil(now / HOUR) * HOUR;
  return intake.limits.map((limit): LimitUse => {
    const resetsAt = limit.period === "window" ? null : limit.reset === "calendar" ? nextCalendarStart(limit.period, now, intake.timezone) : hour + ROLLING_FREES[limit.period];
    return { ...limit, full: limit.used >= limit.count, resetsAt };
  });
}

/** Whether a new report can start and a draft go on, at `now`, and why not. */
export function stateOf(intake: Intake, now: number): IntakeState {
  if (intake.mode === "off") return { open: false, why: "off" };
  if (intake.mode === "dates") {
    if (intake.opensAt !== null && now < intake.opensAt) return { open: false, why: "notYet", at: intake.opensAt };
    if (intake.closesAt !== null && now >= intake.closesAt) return { open: false, why: "ended", at: intake.closesAt };
  }
  const uses = usesOf(intake, now);
  const full = uses.filter((use) => use.full);
  if (!full.length) return { open: true, uses };
  // Every full limit has to start again before a report can go on: the latest of them, or never.
  const reopensAt = full.some((use) => use.resetsAt === null) ? null : Math.max(...full.map((use) => use.resetsAt!));
  // A period that would start again after new reports close doesn't.
  const closes = intake.mode === "dates" ? intake.closesAt : null;
  return { open: false, why: "full", uses, reopensAt: reopensAt !== null && closes !== null && reopensAt >= closes ? null : reopensAt };
}

// The mock's store: this browser's localStorage, read the same in every tab.
const KEY = "mock:new-reports";
const DEFAULT: Intake = { mode: "off", opensAt: null, closesAt: null, timezone: "UTC", limits: [] };
let last: { raw: string | null; value: Intake } | null = null;
const listeners = new Set<() => void>();

function read(): Intake {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {}
  if (last && last.raw === raw) return last.value;
  let value: Intake;
  try {
    value = raw ? { ...DEFAULT, ...(JSON.parse(raw) as Partial<Intake>) } : { ...DEFAULT, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  } catch {
    value = DEFAULT;
  }
  last = { raw, value };
  return value;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab's change: the admin page in one, the Publish page in another.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function saveIntake(next: Intake) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  for (const listener of listeners) listener();
}

export function useIntake(): Intake {
  return useSyncExternalStore(subscribe, read, () => DEFAULT);
}

// The clock, read every 30 seconds: a period that ends while a page is open closes it there.
const TICK = 30_000;
function subscribeClock(listener: () => void) {
  const timer = window.setInterval(listener, TICK);
  return () => window.clearInterval(timer);
}
const tick = () => Math.floor(Date.now() / TICK) * TICK;

/** Now, to the last 30 seconds. */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, tick, tick);
}

/** Whether new reports are open now, for the Publish page. */
export function useIntakeState(): IntakeState {
  return stateOf(useIntake(), useNow());
}
