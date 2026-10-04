import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { OPENALEX_REQUEST_LIMITS } from "../../lib/openalex/request-limiter";

const { perMinute, perDay } = OPENALEX_REQUEST_LIMITS.account;
const MINUTE = 60_000;

afterEach(() => {
  vi.useRealTimers();
});

describe("an account's OpenAlex requests, counted in Convex", () => {
  it("refuses a burst past the minute without counting it, and keeps accounts apart", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 2, 6) });
    const t = convexTest(schema);
    const ada = t.withIdentity({ subject: "clerk_ada" });
    const grace = t.withIdentity({ subject: "clerk_grace" });

    expect(await ada.mutation(api.openalex.limits.spend, { count: perMinute - 50 })).toBe(true);
    expect(await ada.mutation(api.openalex.limits.spend, { count: 100 })).toBe(false);
    expect(await ada.mutation(api.openalex.limits.spend, { count: 50 })).toBe(true);
    expect(await grace.mutation(api.openalex.limits.spend, { count: perMinute })).toBe(true);
  });

  it("stops at the day's total even as minutes refill, until midnight UTC", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 2, 0, 1) });
    const t = convexTest(schema);
    const ada = t.withIdentity({ subject: "clerk_ada" });
    const fullMinutes = Math.floor(perDay / perMinute);

    for (let minute = 0; minute < fullMinutes; minute++) {
      expect(await ada.mutation(api.openalex.limits.spend, { count: perMinute })).toBe(true);
      vi.advanceTimersByTime(MINUTE);
    }
    const left = perDay - fullMinutes * perMinute;
    expect(await ada.mutation(api.openalex.limits.spend, { count: left + 1 })).toBe(false);
    expect(await ada.mutation(api.openalex.limits.spend, { count: left })).toBe(true);
    expect(await ada.mutation(api.openalex.limits.spend, { count: 1 })).toBe(false);

    vi.setSystemTime(Date.UTC(2026, 9, 3, 0, 0, 1));
    expect(await ada.mutation(api.openalex.limits.spend, { count: 1 })).toBe(true);
  });

  it("refuses a caller who isn't signed in", async () => {
    const t = convexTest(schema);
    await expect(t.mutation(api.openalex.limits.spend, { count: 1 })).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });
});
