import { describe, it, expect } from "vitest";
import {
  groupKeyFor,
  groupLabel,
  partitionByGroup,
  shouldRenderGroups,
} from "./grouping";

describe("groupKeyFor", () => {
  const now = Date.UTC(2026, 3, 20, 15, 0, 0); // 2026-04-20T15:00Z, a Monday

  it("same-day → today", () => {
    expect(groupKeyFor(now, now, "UTC")).toBe("today");
  });

  it("yesterday (1 calendar day back) → yesterday", () => {
    const ts = Date.UTC(2026, 3, 19, 10, 0, 0);
    expect(groupKeyFor(ts, now, "UTC")).toBe("yesterday");
  });

  it("2 days ago on Saturday → this-week (Mon-anchored week)", () => {
    const ts = Date.UTC(2026, 3, 18, 10, 0, 0); // Sat 2026-04-18
    expect(groupKeyFor(ts, now, "UTC")).toBe("this-week");
  });

  it("Sunday 2 weeks ago → last-week", () => {
    const ts = Date.UTC(2026, 3, 12, 10, 0, 0); // Sun 2026-04-12 (in last-week)
    expect(groupKeyFor(ts, now, "UTC")).toBe("last-week");
  });

  it("older → month-YYYY-MM", () => {
    const ts = Date.UTC(2026, 2, 14, 12, 0, 0); // 2026-03-14
    expect(groupKeyFor(ts, now, "UTC")).toBe("month-2026-03");
  });

  it("even older crosses a year → month-YYYY-MM with the right year", () => {
    const ts = Date.UTC(2025, 11, 2, 12, 0, 0); // 2025-12-02
    expect(groupKeyFor(ts, now, "UTC")).toBe("month-2025-12");
  });
});

describe("groupLabel", () => {
  it("today → i18nKey group.today, no params", () => {
    expect(groupLabel("today")).toEqual({ i18nKey: "group.today" });
  });

  it("yesterday → i18nKey group.yesterday", () => {
    expect(groupLabel("yesterday")).toEqual({ i18nKey: "group.yesterday" });
  });

  it("this-week → i18nKey group.thisWeek", () => {
    expect(groupLabel("this-week")).toEqual({ i18nKey: "group.thisWeek" });
  });

  it("last-week → i18nKey group.lastWeek", () => {
    expect(groupLabel("last-week")).toEqual({ i18nKey: "group.lastWeek" });
  });

  it("month-2026-03 → i18nKey group.month with year+month params", () => {
    expect(groupLabel("month-2026-03")).toEqual({
      i18nKey: "group.month",
      params: { year: 2026, month: 3 },
    });
  });
});

describe("partitionByGroup", () => {
  const now = Date.UTC(2026, 3, 20, 15, 0, 0);

  it("groups rows by bucket and preserves input order within each group", () => {
    const rows = [
      { createdAt: Date.UTC(2026, 3, 20, 14, 0, 0), id: "a" }, // today
      { createdAt: Date.UTC(2026, 3, 20, 13, 0, 0), id: "b" }, // today
      { createdAt: Date.UTC(2026, 3, 19, 10, 0, 0), id: "c" }, // yesterday
      { createdAt: Date.UTC(2026, 2, 14, 9, 0, 0), id: "d" }, // month-2026-03
    ];
    const out = partitionByGroup(rows, now, "UTC");
    expect(out.map(([key]) => key)).toEqual([
      "today",
      "yesterday",
      "month-2026-03",
    ]);
    expect(out[0][1].map((r) => r.id)).toEqual(["a", "b"]);
    expect(out[1][1].map((r) => r.id)).toEqual(["c"]);
    expect(out[2][1].map((r) => r.id)).toEqual(["d"]);
  });

  it("returns an empty array when given no rows", () => {
    expect(partitionByGroup([], now, "UTC")).toEqual([]);
  });
});

describe("shouldRenderGroups", () => {
  it("true when sorting by date desc", () => {
    expect(shouldRenderGroups({ field: "date", dir: "desc" })).toBe(true);
  });

  it("false when sorting by date asc (chronologically ascending lies when grouped)", () => {
    expect(shouldRenderGroups({ field: "date", dir: "asc" })).toBe(false);
  });

  it("false when sorting by amount", () => {
    expect(shouldRenderGroups({ field: "amount", dir: "desc" })).toBe(false);
  });
});
