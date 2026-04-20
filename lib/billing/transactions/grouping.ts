export type GroupKey =
  | "today"
  | "yesterday"
  | "this-week"
  | "last-week"
  | `month-${number}-${string}`;

export interface GroupLabel {
  i18nKey: string;
  params?: Record<string, string | number>;
}

export function groupKeyFor(ts: number, now: number, tz: string): GroupKey {
  const diffDays = calendarDayDiff(now, ts, tz);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays <= 7) return "this-week";
  if (diffDays <= 14) return "last-week";
  const { year, month } = calendarParts(ts, tz);
  const monthStr = month.toString().padStart(2, "0");
  return `month-${year}-${monthStr}` as GroupKey;
}

const MONTH_KEY_PATTERN = /^month-(\d{4})-(\d{2})$/;

export function groupLabel(key: GroupKey): GroupLabel {
  if (key === "today") return { i18nKey: "group.today" };
  if (key === "yesterday") return { i18nKey: "group.yesterday" };
  if (key === "this-week") return { i18nKey: "group.thisWeek" };
  if (key === "last-week") return { i18nKey: "group.lastWeek" };
  const match = MONTH_KEY_PATTERN.exec(key);
  if (!match) {
    throw new Error(`Unrecognized GroupKey: ${key}`);
  }
  return {
    i18nKey: "group.month",
    params: { year: Number(match[1]), month: Number(match[2]) },
  };
}

export function partitionByGroup<T extends { createdAt: number }>(
  rows: readonly T[],
  now: number,
  tz: string,
): ReadonlyArray<readonly [GroupKey, readonly T[]]> {
  const ordered: GroupKey[] = [];
  const buckets = new Map<GroupKey, T[]>();
  for (const row of rows) {
    const key = groupKeyFor(row.createdAt, now, tz);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      ordered.push(key);
    }
    bucket.push(row);
  }
  return ordered.map((key) => [key, buckets.get(key)!] as const);
}

export function shouldRenderGroups(sort: { field: string; dir: "asc" | "desc" }): boolean {
  return sort.field === "date" && sort.dir === "desc";
}

function calendarDayDiff(laterMs: number, earlierMs: number, tz: string): number {
  return calendarDayOrdinal(laterMs, tz) - calendarDayOrdinal(earlierMs, tz);
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
