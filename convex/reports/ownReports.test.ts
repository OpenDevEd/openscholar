import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import { atDetails, live, setup } from "./reports.test-support";

// Already published searches Openscholar Reports' own live reports first: R100444 passed although the same slides had
// gone live as R100438 minutes before, because none of the other places had it yet (2026-11-12).
describe("the live reports Already published compares a report with", () => {
  it("are the live ones with a title like its own, never itself, nor one that isn't live", async () => {
    const world = await setup();
    // The author's own workspace starts one report a day, the organisation's five.
    const published = await live(world);
    const draft = await atDetails(world, world.author, world.lab);
    const checking = await atDetails(world, world.author, world.lab);
    const alike = await world.t.query(internal.reports.ownReports.alike, { reportId: checking.reportId, title: "Shade trees and maize yields" });
    expect(alike.map((report) => report.url)).toEqual([`/papers/${published.key}`]);
    expect(alike[0]).toMatchObject({ title: "Shade trees and maize yields", year: "2026" });
    expect(alike.some((report) => report.url.endsWith(draft.key))).toBe(false);
    const fromItself = await world.t.query(internal.reports.ownReports.alike, { reportId: published.reportId, title: "Shade trees and maize yields" });
    expect(fromItself).toEqual([]);
  });

  it("are found for a title longer than a search takes, and for one written without spaces", async () => {
    const world = await setup();
    const published = await live(world);
    const checking = await atDetails(world, world.author, world.lab);
    for (const title of ["Shade trees and maize yields on smallholder farms in the western highlands of Kenya, a study over three seasons with farmers", "人工智能与人类智能的价值快速学习放慢行动"]) {
      await world.t.run((ctx) => ctx.db.patch("reports", published.reportId, { title }));
      const alike = await world.t.query(internal.reports.ownReports.alike, { reportId: checking.reportId, title });
      expect(alike.map((report) => report.url)).toEqual([`/papers/${published.key}`]);
    }
  });
});
