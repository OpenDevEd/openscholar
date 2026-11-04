import { gunzipSync } from "node:zlib";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

/** What PostHog's batch endpoint received, gzipped or not. */
async function sentEvents(fetchMock: ReturnType<typeof vi.fn>) {
  const batches = await Promise.all(
    fetchMock.mock.calls.map(async (call) => {
      const init = call[1] as RequestInit;
      const raw = new Uint8Array(await new Response(init.body).arrayBuffer());
      const gzipped = new Headers(init.headers).get("Content-Encoding") === "gzip";
      return JSON.parse((gzipped ? gunzipSync(raw) : Buffer.from(raw)).toString()) as { batch: Array<Record<string, any>> };
    }),
  );
  return batches.flatMap((body) => body.batch);
}

const addUser = (t: ReturnType<typeof convexTest>, clerkId: string, choice?: "granted" | "denied") =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.org`,
      state: "active",
      createdAt: 1,
      updatedAt: 1,
      ...(choice && { analyticsConsent: { choice, at: 1 } }),
    }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("analytics.capture", () => {
  it("sends each event with the time it happened, the site it came from, and no GeoIP from this server", async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    vi.stubEnv("POSTHOG_HOST", "https://posthog.example.test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://dev.openscholar.example");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 1 })));
    vi.stubGlobal("fetch", fetchMock);
    const happenedAt = Date.UTC(2026, 9, 6, 12, 0, 0);

    const t = convexTest(schema);
    await addUser(t, "user_a", "granted");
    await addUser(t, "user_b", "granted");
    await t.action(internal.lib.analytics.capture, {
      events: [
        { distinctId: "user_a", event: "screening_job_completed", properties: JSON.stringify({ total_papers: 3 }), timestamp: happenedAt },
        { distinctId: "user_b", event: "$ai_generation", properties: JSON.stringify({ $ai_model: "m" }), timestamp: happenedAt + 1000 },
      ],
    });

    const events = await sentEvents(fetchMock);
    expect(events.map((event) => [event.event, event.distinct_id, event.timestamp])).toEqual([
      ["screening_job_completed", "user_a", new Date(happenedAt).toISOString()],
      ["$ai_generation", "user_b", new Date(happenedAt + 1000).toISOString()],
    ]);
    for (const event of events) {
      expect(event.properties.environment).toBe("dev.openscholar.example");
      expect(event.properties.$geoip_disable).toBe(true);
      expect(event.uuid).toEqual(expect.any(String));
    }
    expect(new Set(events.map((event) => event.uuid)).size).toBe(2);
  });

  it("names only someone who accepted analytics, and keeps the totals of everyone else", async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 1 })));
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema);
    await addUser(t, "user_accepted", "granted");
    await addUser(t, "user_rejected", "denied");
    await addUser(t, "user_unanswered");
    const properties = JSON.stringify({
      $ai_model: "m",
      $ai_input_tokens: 10,
      $ai_session_id: "job_1",
      $ai_trace_id: "trace_1",
      feature: "Screening",
      credits_deducted: 2,
      credits_remaining: 90,
      job_id: "job_1",
    });

    await t.action(internal.lib.analytics.capture, {
      events: ["user_accepted", "user_rejected", "user_unanswered"].map((distinctId) => ({ distinctId, event: "$ai_generation", properties, timestamp: 1 })),
    });

    const [accepted, ...others] = await sentEvents(fetchMock);
    expect(accepted.distinct_id).toBe("user_accepted");
    expect(accepted.properties.job_id).toBe("job_1");
    expect(others).toHaveLength(2);
    for (const event of others) {
      expect(event.distinct_id).toBe("no-analytics-consent");
      expect(event.properties).toMatchObject({ $ai_model: "m", $ai_input_tokens: 10, feature: "Screening", credits_deducted: 2, $process_person_profile: false });
      for (const key of ["$ai_session_id", "$ai_trace_id", "credits_remaining", "job_id"]) expect(event.properties).not.toHaveProperty(key);
    }
  });

  it("keeps the latest banner answer, whichever device sends it last", async () => {
    const t = convexTest(schema);
    await addUser(t, "user_a");
    const person = t.withIdentity({ subject: "user_a" });
    const saved = () => t.run(async (ctx) => (await ctx.db.query("users").first())?.analyticsConsent);

    await person.mutation(api.users.mutations.saveAnalyticsConsent, { choice: "granted", at: 10 });
    await person.mutation(api.users.mutations.saveAnalyticsConsent, { choice: "denied", at: 20 });
    await person.mutation(api.users.mutations.saveAnalyticsConsent, { choice: "granted", at: 15 });

    expect(await saved()).toEqual({ choice: "denied", at: 20 });
  });

  it("sends nothing where PostHog isn't set up", async () => {
    vi.stubEnv("POSTHOG_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await convexTest(schema).action(internal.lib.analytics.capture, {
      events: [{ distinctId: "user_a", event: "x", properties: "{}", timestamp: Date.now() }],
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
