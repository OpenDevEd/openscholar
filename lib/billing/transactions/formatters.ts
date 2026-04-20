const UNICODE_MINUS = "−";

export function formatSignedAmount(amount: number, direction: "in" | "out"): string {
  const abs = Math.abs(amount).toLocaleString("en-US");
  return direction === "in" ? `+${abs}` : `${UNICODE_MINUS}${abs}`;
}

export function formatBalance(balance: number): string {
  return balance.toLocaleString("en-US");
}

export type RelativeBucket = "today" | "yesterday" | "this-week" | "older";

export function relativeTimeBucket(
  ts: number,
  now: number,
  tz: string,
): RelativeBucket {
  const diffDays = calendarDayDiff(now, ts, tz);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays <= 7) return "this-week";
  return "older";
}

function calendarDayDiff(laterMs: number, earlierMs: number, tz: string): number {
  const later = calendarDayOrdinal(laterMs, tz);
  const earlier = calendarDayOrdinal(earlierMs, tz);
  return later - earlier;
}

function calendarDayOrdinal(ms: number, tz: string): number {
  const { year, month, day } = calendarParts(ms, tz);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function calendarParts(ms: number, tz: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  let year = 0;
  let month = 0;
  let day = 0;
  for (const p of parts) {
    if (p.type === "year") year = Number(p.value);
    else if (p.type === "month") month = Number(p.value);
    else if (p.type === "day") day = Number(p.value);
  }
  return { year, month, day };
}
