import { describe, expect, it } from "vitest";
import { INTAKE_OFF, calendarStart, intakeAt, intakeProblem, nthsOf, usedAt, type Intake, type Limit } from "./intake";

const at = (iso: string) => Date.parse(iso);
const DAY = 86_400_000;
const open = (patch: Partial<Intake> = {}): Intake => ({ ...INTAKE_OFF, mode: "on", openedAt: at("2026-11-01T00:00Z"), ...patch });
const limit = (patch: Partial<Limit>): Limit => ({ id: "a", count: 2, period: "week", reset: "calendar", ...patch });

describe("calendarStart", () => {
  it("starts the week on Monday at midnight in the timezone, not in UTC", () => {
    // Tuesday 24 November, noon UTC, is Tuesday evening in Tokyo: its week began Monday 23rd at 00:00 JST.
    expect(calendarStart("week", at("2026-11-24T12:00Z"), "Asia/Tokyo")).toBe(at("2026-11-22T15:00Z"));
    expect(calendarStart("week", at("2026-11-24T12:00Z"), "Asia/Tokyo", 1)).toBe(at("2026-11-29T15:00Z"));
    // Monday 01:00 in Tokyo is still Sunday in UTC: the week has just begun there.
    expect(calendarStart("week", at("2026-11-29T16:00Z"), "Asia/Tokyo")).toBe(at("2026-11-29T15:00Z"));
  });

  it("follows a clock change: midnights either side of New York's switch to summer time are 23 hours apart", () => {
    const now = at("2026-03-08T12:00Z");
    expect(calendarStart("day", now, "America/New_York")).toBe(at("2026-03-08T05:00Z"));
    expect(calendarStart("day", now, "America/New_York", 1)).toBe(at("2026-03-09T04:00Z"));
  });

  it("starts a day whose midnight a clock change skips at the first instant of it", () => {
    // Santiago goes from UTC-4 to UTC-3 at midnight on 6 September 2026: the day starts at 01:00, 04:00 UTC.
    expect(calendarStart("day", at("2026-09-06T12:00Z"), "America/Santiago")).toBe(at("2026-09-06T04:00Z"));
  });

  it("starts the month on the 1st, and the next one across the year's end", () => {
    expect(calendarStart("month", at("2026-12-20T10:00Z"), "UTC")).toBe(at("2026-12-01T00:00Z"));
    expect(calendarStart("month", at("2026-12-20T10:00Z"), "UTC", 1)).toBe(at("2027-01-01T00:00Z"));
  });
});

describe("intakeAt", () => {
  const now = at("2026-11-24T12:00Z");

  it("waits for the opening date and stops at the closing one", () => {
    const dates = open({ mode: "dates", opensAt: at("2026-11-30T08:00Z"), closesAt: at("2026-12-04T17:00Z") });
    expect(intakeAt(dates, {}, now)).toEqual({ open: false, why: "notYet", at: dates.opensAt });
    expect(intakeAt(dates, {}, at("2026-12-01T00:00Z"))).toEqual({ open: true });
    expect(intakeAt(dates, {}, at("2026-12-04T17:00Z"))).toEqual({ open: false, why: "ended", at: dates.closesAt });
    expect(intakeAt(INTAKE_OFF, {}, now)).toEqual({ open: false, why: "off" });
  });

  it("is full while the activation that filled a calendar week is in it, until next Monday", () => {
    const week = open({ limits: [limit({})] });
    expect(intakeAt(week, { a: at("2026-11-23T09:00Z") }, now)).toEqual({ open: false, why: "full", reopensAt: at("2026-11-30T00:00Z") });
    // The second latest was made last week: this week has one, a place left.
    expect(intakeAt(week, { a: at("2026-11-20T09:00Z") }, now)).toEqual({ open: true });
    expect(intakeAt(week, { a: null }, now)).toEqual({ open: true });
  });

  it("frees a rolling place when the activation that filled it is 7 days old", () => {
    const rolling = open({ limits: [limit({ reset: "rolling" })] });
    const filled = at("2026-11-20T09:00Z");
    expect(intakeAt(rolling, { a: filled }, now)).toEqual({ open: false, why: "full", reopensAt: filled + 7 * DAY });
    expect(intakeAt(rolling, { a: filled }, filled + 7 * DAY)).toEqual({ open: true });
  });

  it("never reopens a limit on the whole time open, nor one whose next period starts after new reports close", () => {
    const total = open({ limits: [limit({ period: "window" })] });
    expect(intakeAt(total, { a: at("2026-11-02T00:00Z") }, now)).toEqual({ open: false, why: "full", reopensAt: null });
    // Filled before new reports were switched on this time: those don't count.
    expect(intakeAt(total, { a: at("2026-10-30T00:00Z") }, now)).toEqual({ open: true });
    const shortWindow = open({ mode: "dates", closesAt: at("2026-11-27T17:00Z"), limits: [limit({})] });
    expect(intakeAt(shortWindow, { a: at("2026-11-23T09:00Z") }, now)).toEqual({ open: false, why: "full", reopensAt: null });
  });
});

describe("usedAt and nthsOf", () => {
  it("count only the activations in the period, from the latest", () => {
    const week = open({ limits: [limit({ count: 3 })] });
    const latest = [at("2026-11-24T08:00Z"), at("2026-11-23T01:00Z"), at("2026-11-22T23:00Z"), at("2026-11-10T00:00Z")];
    expect(usedAt(week.limits[0], week, latest, at("2026-11-24T12:00Z"))).toBe(2);
    expect(nthsOf(week.limits, latest)).toEqual({ a: latest[2] });
  });
});

describe("intakeProblem", () => {
  it("refuses a new closing time already past, but keeps one saved before", () => {
    const now = at("2026-11-24T12:00Z");
    const past = open({ mode: "dates", closesAt: at("2026-11-20T00:00Z") });
    expect(intakeProblem(past, now, INTAKE_OFF)).not.toBeNull();
    expect(intakeProblem(past, now, past)).toBeNull();
    expect(intakeProblem(open({ timezone: "Mars/Olympus" }), now, INTAKE_OFF)).not.toBeNull();
    expect(intakeProblem(open({ limits: [limit({ count: 0 })] }), now, INTAKE_OFF)).not.toBeNull();
  });
});
