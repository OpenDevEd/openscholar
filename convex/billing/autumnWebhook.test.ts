import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { fakeAutumn, installFakeAutumn } from "./billing.test-support";

// Svix signs with the base64 part of a whsec_ secret.
const SECRET_BYTES = Buffer.from("autumn-webhook-test-secret");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

function signedRequest(body: string, { secondsAgo = 0, secret = SECRET_BYTES } = {}) {
  const id = "msg_1";
  const timestamp = String(Math.floor(Date.now() / 1000) - secondsAgo);
  const signature = createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64");
  return {
    method: "POST",
    headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` },
    body,
  };
}

describe("Autumn's webhook", () => {
  beforeEach(() => {
    process.env.AUTUMN_WEBHOOK_SECRET = SECRET;
    vi.useFakeTimers();
    installFakeAutumn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function seedUser(t: ReturnType<typeof convexTest>) {
    return await t.run((ctx) =>
      ctx.db.insert("users", {
        clerkId: "clerk_webhook",
        email: "webhook@test.local",
        state: "active" as const,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
  }

  const accountFor = (t: ReturnType<typeof convexTest>) =>
    t.run((ctx) => ctx.db.query("billingAccounts").first());

  it("refreshes the customer's account when Autumn reports a change", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    // A change made in Autumn's dashboard that the app hasn't seen.
    fakeAutumn.setBalance(userId, { free: 700 });
    const body = JSON.stringify({ type: "customer.products.updated", data: { customer: { id: userId } } });

    const response = await t.fetch("/webhooks/autumn", signedRequest(body));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(response.status).toBe(204);
    expect((await accountFor(t))?.balance).toBe(700);
  });

  it("answers with an error when Autumn can't be read, so Svix retries the delivery", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    vi.stubGlobal("fetch", async () => new Response("Autumn is down", { status: 503 }));
    const body = JSON.stringify({ type: "customer.products.updated", data: { customer: { id: userId } } });

    const response = await t.fetch("/webhooks/autumn", signedRequest(body));

    expect(response.status).toBe(500);
  });

  it("rejects a forged or replayed delivery and refreshes nothing", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const body = JSON.stringify({ type: "customer.products.updated", data: { customer: { id: userId } } });

    const forged = await t.fetch("/webhooks/autumn", signedRequest(body, { secret: Buffer.from("wrong") }));
    const replayed = await t.fetch("/webhooks/autumn", signedRequest(body, { secondsAgo: 60 * 60 }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(forged.status).toBe(401);
    expect(replayed.status).toBe(401);
    expect(await accountFor(t)).toBeNull();
  });
});
