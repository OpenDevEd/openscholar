import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import { DEFAULT_IDENTIFIERS, type Identifiers } from "../../lib/reports/identifiers";
import { refused, row, setup, type World } from "./reports.test-support";

/** The series with DOCiD's account connected and these identifier settings. */
async function withDocid(world: World, identifiers: Identifiers) {
  await world.t.run(async (ctx) => {
    const settings = (await ctx.db.query("reportSettings").first())!;
    await ctx.db.patch("reportSettings", settings._id, { identifiers, publication: { ...settings.publication, docid: { mode: "custom", email: "docid@test.local", resourceTypeId: 18, publicationTypeId: 5, funderTypeId: 1 } } });
  });
}

const sign = (world: World, services: Array<"crossref" | "zenodo" | "docid">, archive?: "own") =>
  world.author.mutation(api.reports.flow.sign, { workspaceId: world.own, name: "Ada Author", onBehalfOfAll: true, version: 1, licence: "CC BY 4.0", services, ...(archive && { archive }) });

describe("identifier services on reports", () => {
  it("gives a report the DOCiD its author picked, after its Crossref DOI", async () => {
    const world = await setup();
    await withDocid(world, { ...DEFAULT_IDENTIFIERS, services: { ...DEFAULT_IDENTIFIERS.services, zenodo: { mode: "off", price: 0 }, docid: { mode: "optional", price: 5 } } });
    const key = await sign(world, ["docid"]);
    const report = await row(world.t, key);
    expect(report.registration).toMatchObject({ crossref: true, docid: true, cited: "crossref" });
    expect(report.doi).toBe(`10.53832/openscholar-r.${key.toLowerCase()}`);
  });

  it("refuses a pick the series' rule doesn't allow", async () => {
    const world = await setup();
    await withDocid(world, { ...DEFAULT_IDENTIFIERS, services: { crossref: { mode: "optional", price: 0 }, zenodo: { mode: "off", price: 0 }, docid: { mode: "optional", price: 0 } }, choose: { min: 1, max: 1 }, docidAtSigning: true });
    await expect(sign(world, ["crossref", "docid"])).rejects.toMatchObject(refused("VALIDATION_ERROR"));
  });

  it("reserves no DOI for a report that only gets a DOCiD, which its byline then prints", async () => {
    const world = await setup();
    await withDocid(world, { ...DEFAULT_IDENTIFIERS, services: { crossref: { mode: "optional", price: 0 }, zenodo: { mode: "off", price: 0 }, docid: { mode: "optional", price: 0 } }, choose: { min: 1, max: 1 }, docidAtSigning: true });
    const key = await sign(world, ["docid"]);
    const report = await row(world.t, key);
    expect(report.doi).toBe("");
    expect(report.registration).toMatchObject({ crossref: false, docid: true, cited: "docid" });
    // DOCiD mints it in the background; once it has, the line the PDF carries names it.
    await world.t.mutation(internal.reports.registration.mintedAtSigning, { reportId: report._id, handle: "20.500.14351/abc123" });
    expect((await row(world.t, key)).byline).toContain("https://hdl.handle.net/20.500.14351/abc123");
  });

  it("refuses an own Zenodo archive for a report with no Crossref DOI to keep it under", async () => {
    const world = await setup();
    await withDocid(world, { ...DEFAULT_IDENTIFIERS, services: { crossref: { mode: "optional", price: 0 }, zenodo: { mode: "off", price: 0 }, docid: { mode: "optional", price: 0 } }, choose: { min: 1, max: 1 }, docidAtSigning: true });
    await expect(sign(world, ["docid"], "own")).rejects.toMatchObject(refused("VALIDATION_ERROR"));
  });

  it("keeps DOCiD's refusal for the reviewer, and sends it again", async () => {
    const world = await setup();
    await withDocid(world, { ...DEFAULT_IDENTIFIERS, services: { ...DEFAULT_IDENTIFIERS.services, zenodo: { mode: "off", price: 0 }, docid: { mode: "required", price: 0 } } });
    const key = await sign(world, []);
    const { _id: reportId } = await row(world.t, key);
    await world.t.run((ctx) => ctx.db.patch("reports", reportId, { status: "live", step: "done", activatedAt: 1, deposit: "deposited", registrations: { docid: { state: "queued", handle: "20.500.14351/abc123" } }, registrationRev: 1 }));
    expect(await world.t.mutation(internal.reports.registration.settle, { reportId, rev: 1, provider: "docid", outcome: "refused", error: "DOCiD answered 403: Resource type not permitted for your account" })).toBe(false);
    expect((await row(world.t, key)).registrations?.docid).toMatchObject({ state: "failed", handle: "20.500.14351/abc123" });
    await world.reviewer.mutation(api.reports.registration.retry, { key });
    const again = await row(world.t, key);
    expect(again.registrations?.docid).toMatchObject({ state: "queued", handle: "20.500.14351/abc123" });
    expect(again.deposit).toBe("deposited");
  });
});
