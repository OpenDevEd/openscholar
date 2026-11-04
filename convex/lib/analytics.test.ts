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
      to_plan: "pro",
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
      expect(event.properties).toMatchObject({ $ai_model: "m", $ai_input_tokens: 10, feature: "Screening", to_plan: "pro", credits_deducted: 2, $process_person_profile: false });
      for (const key of ["$ai_session_id", "$ai_trace_id", "credits_remaining", "job_id"]) expect(event.properties).not.toHaveProperty(key);
    }
  });

  it("takes a new banner answer as it comes, and at sign-in lets a rejection hold over an older acceptance", async () => {
    const t = convexTest(schema);
    const person = t.withIdentity({ subject: "user_a" });
    const saved = async () => (await t.run(async (ctx) => (await ctx.db.query("users").first())?.analyticsConsent))?.choice;

    // A new account takes what the browser already holds.
    await person.mutation(api.users.mutations.ensureUser, { analyticsConsent: "granted" });
    expect(await saved()).toBe("granted");
    // Rejected in a browser while signed out, then signed in.
    await person.mutation(api.users.mutations.ensureUser, { analyticsConsent: "denied" });
    expect(await saved()).toBe("denied");
    // Another browser's older acceptance doesn't undo that.
    await person.mutation(api.users.mutations.ensureUser, { analyticsConsent: "granted" });
    expect(await saved()).toBe("denied");
    // Pressing Accept does, and so does pressing Reject again.
    await person.mutation(api.users.mutations.saveAnalyticsConsent, { choice: "granted" });
    expect(await saved()).toBe("granted");
    await person.mutation(api.users.mutations.saveAnalyticsConsent, { choice: "denied" });
    expect(await saved()).toBe("denied");
    // A browser with no answer changes nothing.
    await person.mutation(api.users.mutations.ensureUser, {});
    expect(await saved()).toBe("denied");
  });

  it("records a sign-up, a first payment and a change of plan, each once", async () => {
    const t = convexTest(schema);
    const person = t.withIdentity({ subject: "user_a" });
    await person.mutation(api.users.mutations.ensureUser, {});
    const workspaceId = await t.run(async (ctx) => (await ctx.db.query("workspaces").first())!._id);
    const write = (plan: string, hasPaid: boolean, fetchedAt: number) =>
      t.mutation(internal.billing.accounts.writeSnapshot, {
        workspaceId,
        withCard: false,
        fetchedAt,
        snapshot: { plan, hasPaid, pastDue: false, balance: 0, purchased: 0, signupGranted: true },
      });
    await write("free", false, 1);
    await write("free", false, 2);
    await write("pro", true, 3);
    await write("pro", true, 4);
    await write("go", true, 5);

    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const sent = scheduled.flatMap((job) => (job.args[0] as { events?: Array<{ event: string; distinctId: string; properties: string }> }).events ?? []);
    expect(sent.map(({ event, distinctId, properties }) => [event, distinctId, JSON.parse(properties)])).toEqual([
      ["account_created", "user_a", {}],
      ["first_payment", "user_a", { workspace_kind: "personal", plan: "pro" }],
      ["plan_changed", "user_a", { workspace_kind: "personal", from_plan: "free", to_plan: "pro" }],
      ["plan_changed", "user_a", { workspace_kind: "personal", from_plan: "pro", to_plan: "go" }],
    ]);
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
