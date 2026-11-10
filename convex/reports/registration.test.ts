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
const settle = (world: World, reportId: Awaited<ReturnType<typeof live>>["reportId"], provider: "crossref" | "zenodo", outcome: "done" | "refused" | "unreached", error?: string) =>
  world.t.mutation(internal.reports.registration.settle, { reportId, provider, outcome, ...(error && { error }) });

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
