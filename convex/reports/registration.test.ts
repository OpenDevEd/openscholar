import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapCrossrefRecord } from "@opendeved/doi-sync-core";
import { api, internal } from "../_generated/api";
import { registrationRecord } from "../../lib/reports/registration-record";
import { REGISTRATION_TRIES } from "./registration";
import { details, live, refused, row, setup, type World } from "./reports.test-support";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://openscholar.test");
  vi.stubEnv("EL_SMTP_HOST", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const settled = (world: World) => world.t.finishAllScheduledFunctions(vi.runAllTimers);
type ReportId = Awaited<ReturnType<typeof live>>["reportId"];
const revOf = async (world: World, reportId: ReportId) => (await world.t.run((ctx) => ctx.db.get("reports", reportId)))!.registrationRev!;
/** A registrar's answer to the report's latest asking, or to the one `rev` names. */
const settle = async (world: World, reportId: ReportId, provider: "crossref" | "zenodo", outcome: "done" | "refused" | "unreached", error?: string, rev?: number) =>
  world.t.mutation(internal.reports.registration.settle, { reportId, rev: rev ?? (await revOf(world, reportId)), provider, outcome, ...(error && { error }) });

describe("a report's record for its registrars", () => {
  const report = { key: "R100001", doi: "10.53832/openscholar-r.r100001", withdrawn: false };
  const m = { ...details("Shade trees"), subtitle: "Evidence from Malawi", authors: [{ name: "Chikondi  Banda", orcid: "0000-0002-1825-0097", openalexId: null, affiliations: [{ id: null, name: "LUANAR", country: "MW" }], corresponding: true, roles: [] }, { name: "Plato", orcid: "", openalexId: null, affiliations: [], corresponding: false, roles: [] }] };
  const series = { name: "Openscholar Reports", issn: "" };

  it("is one Crossref takes as a report, with each person's family name found", () => {
    const record = registrationRecord(report, m, series, "cc-by-4.0", "https://openscholar.ai/");
    expect(record).toMatchObject({ itemType: "Report", title: "Shade trees: Evidence from Malawi", landingUrl: "https://openscholar.ai/papers/R100001", publisher: "Openscholar", institution: "Openscholar Reports" });
    expect(record.creators).toEqual([
      { type: "personal", name: "Banda, Chikondi", creatorType: "author", givenName: "Chikondi", familyName: "Banda", affiliation: "LUANAR", orcid: "0000-0002-1825-0097" },
      { type: "personal", name: "Plato", creatorType: "author", familyName: "Plato" },
    ]);
    // A body that wrote the report keeps its name whole.
    const body = registrationRecord(report, { ...m, authors: [{ ...m.authors[1]!, name: "World Health Organization" }] }, series, "cc-by-4.0", "https://openscholar.ai");
    expect(body.creators).toEqual([{ type: "organizational", name: "World Health Organization", creatorType: "author" }]);
    expect(mapCrossrefRecord(body, report.doi)).toMatchObject({ ok: true });
    expect(mapCrossrefRecord(record, report.doi)).toMatchObject({ ok: true, record: { kind: "report", metadata: { doi: report.doi } } });
  });

  it("says so in its title once the report is withdrawn, under the same DOI", () => {
    expect(registrationRecord({ ...report, withdrawn: true }, m, series, "cc-by-4.0", "https://openscholar.ai")).toMatchObject({ title: "WITHDRAWN: Shade trees: Evidence from Malawi", doi: report.doi });
  });
});

describe("registering a live report", () => {
  it("is refused in words when no registrar is connected, tells the team, and a reviewer alone can send it again", async () => {
    const world = await setup();
    const { key, reportId } = await live(world);
    await settled(world);
    expect(await row(world.t, key)).toMatchObject({ status: "live", deposit: "failed", registrationError: expect.stringContaining("Crossref isn't connected") });
    expect(await world.t.run(async (ctx) => (await ctx.db.query("reportEmails").withIndex("by_reportId", (q) => q.eq("reportId", reportId)).take(20)).map((email) => email.event))).toContain("Registration refused");
    await expect(world.author.mutation(api.reports.registration.retry, { key })).rejects.toMatchObject(refused("FORBIDDEN"));
    await world.reviewer.mutation(api.reports.registration.retry, { key });
    expect(await row(world.t, key)).toMatchObject({ deposit: "queued" });
    expect(await row(world.t, key)).not.toHaveProperty("registrationError");
    await settled(world);
    // Sent again with nothing connected, it is refused again; with nothing refused there is nothing to send.
    await world.t.run((ctx) => ctx.db.patch("reports", reportId, { deposit: "deposited" }));
    await expect(world.reviewer.mutation(api.reports.registration.retry, { key })).rejects.toMatchObject(refused("CONFLICT"));
  });

  it("keeps each registrar's answer, tries one that couldn't be reached again, and ignores an answer about an older record", async () => {
    const world = await setup();
    const { key, reportId } = await live(world);
    await settled(world);
    await world.t.run((ctx) => ctx.db.patch("reports", reportId, { deposit: "queued", registrationError: undefined }));
    for (let tried = 1; tried < REGISTRATION_TRIES; tried++) {
      await settle(world, reportId, "crossref", "unreached", "Crossref answered 503");
      expect(await row(world.t, key)).toMatchObject({ deposit: "queued", registrationTries: tried });
    }
    await settle(world, reportId, "crossref", "unreached", "Crossref answered 503");
    expect(await row(world.t, key)).toMatchObject({ deposit: "failed", registrationError: "Crossref answered 503" });
    // Already settled: a late answer changes nothing.
    await settle(world, reportId, "crossref", "done");
    expect(await row(world.t, key)).toMatchObject({ deposit: "failed" });
    await world.t.run((ctx) => ctx.db.patch("reports", reportId, { deposit: "queued" }));
    await settle(world, reportId, "crossref", "done");
    expect(await row(world.t, key)).toMatchObject({ deposit: "deposited" });
  });

  it("never takes an answer about the record as it was for the record as it is, and holds a report for one action at a time", async () => {
    const world = await setup();
    const { key, reportId } = await live(world);
    await settled(world);
    const before = await revOf(world, reportId);
    // Corrected while an action for the record as it was is still out: that action's answer registers nothing.
    await world.reviewer.mutation(api.reports.review.editDetails, { key, seenAt: (await row(world.t, key)).updatedAt, metadata: details("A corrected title") });
    expect(await revOf(world, reportId)).toBe(before + 1);
    expect(await settle(world, reportId, "crossref", "done", undefined, before)).toBe(false);
    expect(await row(world.t, key)).toMatchObject({ deposit: "queued" });
    // The record Zenodo made is the report's whichever asking made it.
    await world.t.mutation(internal.reports.registration.settle, { reportId, rev: before, provider: "zenodo", outcome: "done", zenodoRecordId: "638432" });
    expect(await row(world.t, key)).toMatchObject({ zenodoRecordId: "638432" });
    // Two actions for the same asking: the first is given the report, the second nothing until the first lets go.
    await world.t.run((ctx) => ctx.db.patch("reports", reportId, { registrationLease: undefined }));
    const rev = await revOf(world, reportId);
    expect(await world.t.mutation(internal.reports.registration.begin, { reportId, rev })).toMatchObject({ key, waiting: ["crossref"] });
    expect(await world.t.mutation(internal.reports.registration.begin, { reportId, rev })).toBeNull();
    await world.t.mutation(internal.reports.registration.end, { reportId });
    expect(await world.t.mutation(internal.reports.registration.begin, { reportId, rev })).not.toBeNull();
    expect(await world.t.mutation(internal.reports.registration.begin, { reportId, rev: before })).toBeNull();
  });

  it("goes to its registrars again when it is withdrawn and when it is reinstated", async () => {
    const world = await setup();
    const { key, reportId } = await live(world);
    await settled(world);
    const decide = async (decision: "withdraw" | "reinstate") => world.reviewer.mutation(api.reports.review.decide, { key, decision, seenPdfAt: (await row(world.t, key)).pdf!.at });
    for (const decision of ["withdraw", "reinstate"] as const) {
      await world.t.run((ctx) => ctx.db.patch("reports", reportId, { deposit: "deposited", registrationError: undefined }));
      await decide(decision);
      expect(await row(world.t, key)).toMatchObject({ deposit: "queued" });
      await settled(world);
    }
  });
});
