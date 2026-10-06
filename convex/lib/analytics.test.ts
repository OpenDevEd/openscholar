import { gunzipSync } from "node:zlib";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
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

    await convexTest(schema).action(internal.lib.analytics.capture, {
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
