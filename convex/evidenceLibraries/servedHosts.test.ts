// The served hosts listing under refreshes that overlap, overtake or fail partway (#426).
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.ts");
const m = internal.evidenceLibraries.mutations;

describe("served hosts listing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const t = convexTest(schema, modules);
    const check = (hosts: string[]) => t.query(internal.evidenceLibraries.queries.servedHostsCheck, { hosts });
    const rows = (listing: string) => t.run((ctx) => ctx.db.query("evidenceLibraryServedHostRows").withIndex("by_listing_and_host", (q) => q.eq("listing", listing)).take(100));
    const settle = () => t.finishAllScheduledFunctions(vi.runAllTimers);
    return { t, check, rows, settle };
  };

  it("refuses a batch from a refresh that a later one overtook, and drops what it kept", async () => {
    const { t, check, rows, settle } = setup();
    expect(await t.mutation(m.addServedHosts, { listing: "older", startedAt: 1_000, hosts: ["a.example.org"] })).toBe(true);
    await t.mutation(m.addServedHosts, { listing: "newer", startedAt: 2_000, hosts: ["b.example.org"] });
    await t.mutation(m.finishServedHosts, { listing: "newer", startedAt: 2_000, complete: true });
    expect(await t.mutation(m.addServedHosts, { listing: "older", startedAt: 1_000, hosts: ["late.example.org"] })).toBe(false);
    await t.mutation(m.finishServedHosts, { listing: "older", startedAt: 1_000, complete: true });
    await settle();
    expect(await check(["a.example.org", "b.example.org", "late.example.org"])).toEqual({ startedAt: 2_000, served: ["b.example.org"] });
    expect(await rows("older")).toEqual([]);
  });

  it("never shows a refresh that failed partway, and drops its rows", async () => {
    const { t, check, rows, settle } = setup();
    await t.mutation(m.addServedHosts, { listing: "first", startedAt: 1_000, hosts: ["a.example.org"] });
    await t.mutation(m.finishServedHosts, { listing: "first", startedAt: 1_000, complete: true });
    await t.mutation(m.addServedHosts, { listing: "broken", startedAt: 2_000, hosts: ["half.example.org"] });
    expect(await check(["half.example.org"])).toEqual({ startedAt: 1_000, served: [] });
    await t.mutation(m.finishServedHosts, { listing: "broken", startedAt: 2_000, complete: false });
    await settle();
    expect(await check(["a.example.org", "half.example.org"])).toEqual({ startedAt: 1_000, served: ["a.example.org"] });
    expect(await rows("broken")).toEqual([]);
  });

  it("keeps two refreshes begun in the same millisecond apart", async () => {
    const { t, check, settle } = setup();
    await t.mutation(m.addServedHosts, { listing: "one", startedAt: 1_000, hosts: ["one.example.org"] });
    await t.mutation(m.addServedHosts, { listing: "two", startedAt: 1_000, hosts: ["two.example.org"] });
    await t.mutation(m.finishServedHosts, { listing: "one", startedAt: 1_000, complete: true });
    await t.mutation(m.finishServedHosts, { listing: "two", startedAt: 1_000, complete: true });
    await settle();
    expect(await check(["one.example.org", "two.example.org"])).toEqual({ startedAt: 1_000, served: ["one.example.org"] });
  });
});
