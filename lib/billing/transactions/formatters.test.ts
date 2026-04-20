import { describe, it, expect } from "vitest";
import {
  formatBalance,
  formatSignedAmount,
  relativeTimeBucket,
} from "./formatters";

const UNICODE_MINUS = "−";

describe("formatSignedAmount", () => {
  it("direction in → leading + with thousands separator", () => {
    expect(formatSignedAmount(1234, "in")).toBe("+1,234");
  });

  it("direction out → Unicode minus U+2212, not ASCII hyphen", () => {
    expect(formatSignedAmount(500, "out")).toBe(`${UNICODE_MINUS}500`);
    expect(formatSignedAmount(500, "out").charCodeAt(0)).toBe(0x2212);
  });

  it("zero is still signed (direction in → +0)", () => {
    expect(formatSignedAmount(0, "in")).toBe("+0");
  });

  it("accepts a negative raw input and uses abs(amount) for display", () => {
    expect(formatSignedAmount(-2500, "out")).toBe(`${UNICODE_MINUS}2,500`);
  });

  it("large amounts get multiple thousands separators", () => {
    expect(formatSignedAmount(1_234_567, "in")).toBe("+1,234,567");
  });
});

describe("formatBalance", () => {
  it("formats positive balance with thousands separators, no sign", () => {
    expect(formatBalance(12345)).toBe("12,345");
  });

  it("formats zero balance", () => {
    expect(formatBalance(0)).toBe("0");
  });
});

describe("relativeTimeBucket", () => {
  const now = Date.UTC(2026, 3, 20, 15, 0, 0); // 2026-04-20T15:00:00Z (Monday)

  it("same instant → today", () => {
    expect(relativeTimeBucket(now, now, "UTC")).toBe("today");
  });

  it("25h ago → yesterday (crosses the 24h boundary, not just diff<86400)", () => {
    const ts = now - 25 * 3600 * 1000;
    expect(relativeTimeBucket(ts, now, "UTC")).toBe("yesterday");
  });

  it("2 days ago → this-week (when now is mid-week)", () => {
    const ts = now - 2 * 86400 * 1000;
    expect(relativeTimeBucket(ts, now, "UTC")).toBe("this-week");
  });

  it("8 days ago → older", () => {
    const ts = now - 8 * 86400 * 1000;
    expect(relativeTimeBucket(ts, now, "UTC")).toBe("older");
  });

  it("DST spring-forward in America/New_York: 23h elapsed wall-time still resolves to yesterday", () => {
    // On 2026-03-08, America/New_York springs forward at 02:00 → 03:00 local.
    // Local midnight Sun → local midnight Mon is only 23h of UTC time.
    // Use noon Monday 2026-03-09 (ET) = 16:00 UTC as "now"; the same local time
    // on Sunday 2026-03-08 is 15:00 UTC (DST gap absorbs an hour).
    const sundayLocalNoonUtc = Date.UTC(2026, 2, 8, 16, 0, 0); // 2026-03-08T16:00Z = noon EST
    const mondayLocalNoonUtc = Date.UTC(2026, 2, 9, 16, 0, 0); // 2026-03-09T16:00Z = noon EDT
    expect(
      relativeTimeBucket(sundayLocalNoonUtc, mondayLocalNoonUtc, "America/New_York"),
    ).toBe("yesterday");
  });

  it("DST fall-back in America/New_York: 25h elapsed wall-time still resolves to yesterday (not today)", () => {
    // On 2026-11-01, NY falls back at 02:00 → 01:00 local.
    // Noon Saturday 2026-10-31 to noon Sunday 2026-11-01 local is 25h of UTC time.
    const satLocalNoonUtc = Date.UTC(2026, 9, 31, 16, 0, 0); // 16:00Z = noon EDT
    const sunLocalNoonUtc = Date.UTC(2026, 10, 1, 17, 0, 0); // 17:00Z = noon EST
    expect(
      relativeTimeBucket(satLocalNoonUtc, sunLocalNoonUtc, "America/New_York"),
    ).toBe("yesterday");
  });
});
