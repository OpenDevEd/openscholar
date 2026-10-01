import { describe, expect, it } from "vitest";
import { RequestLimiter } from "./request-limiter";

const limit = { perMinute: 3, perDay: 5 };

describe("RequestLimiter", () => {
  it("allows a minute's burst, then refills it over the minute", () => {
    const limiter = new RequestLimiter();
    expect([1, 2, 3, 4].map(() => limiter.take("a", limit, 1, 0))).toEqual([true, true, true, false]);
    expect(limiter.take("a", limit, 1, 20_000)).toBe(true);
    expect(limiter.take("a", limit, 1, 20_000)).toBe(false);
  });

  it("stops at the day's total even when the minute has refilled", () => {
    const limiter = new RequestLimiter();
    for (let minute = 0; minute < 5; minute++) limiter.take("a", limit, 1, minute * 60_000);
    expect(limiter.take("a", limit, 1, 10 * 60_000)).toBe(false);
  });

  it("takes several requests at once only when all fit, and keeps visitors apart", () => {
    const limiter = new RequestLimiter();
    expect(limiter.take("a", limit, 4, 0)).toBe(false);
    expect(limiter.take("a", limit, 3, 0)).toBe(true);
    expect(limiter.take("b", limit, 3, 0)).toBe(true);
  });

  it("forgets the oldest visitor when it holds too many", () => {
    const limiter = new RequestLimiter(2);
    limiter.take("a", limit, 3, 0);
    limiter.take("b", limit, 1, 0);
    limiter.take("c", limit, 1, 0);
    expect(limiter.take("a", limit, 3, 0)).toBe(true);
  });
});
