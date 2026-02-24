import { describe, expect, it } from "vitest";
import { Webhook } from "svix";
import { verifyClerkWebhookPayload } from "../convex/webhooks/actions";

describe("clerk webhook verification", () => {
  it("fails when CLERK_WEBHOOK_SIGNING_SECRET is missing", () => {
    const result = verifyClerkWebhookPayload({
      payloadText: "{}",
      svixId: "msg_missing_secret",
      svixTimestamp: String(Math.floor(Date.now() / 1000)),
      svixSignature: "v1,invalid",
      webhookSecret: undefined,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("CLERK_WEBHOOK_SIGNING_SECRET");
    }
  });

  it("fails when signature is invalid", () => {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const result = verifyClerkWebhookPayload({
      payloadText: JSON.stringify({
        id: "evt_invalid",
        type: "user.updated",
        data: { id: "user_123" },
      }),
      svixId: "msg_invalid_signature",
      svixTimestamp: String(Math.floor(Date.now() / 1000)),
      svixSignature: "v1,this-is-not-valid",
      webhookSecret: secret,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).not.toContain("CLERK_WEBHOOK_SIGNING_SECRET format");
    }
  });

  it("fails when signing secret format is invalid", () => {
    const result = verifyClerkWebhookPayload({
      payloadText: JSON.stringify({
        id: "evt_invalid_secret",
        type: "user.updated",
        data: { id: "user_123" },
      }),
      svixId: "msg_invalid_secret",
      svixTimestamp: String(Math.floor(Date.now() / 1000)),
      svixSignature: "v1,this-is-not-valid",
      webhookSecret: "whsec_test_secret",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("CLERK_WEBHOOK_SIGNING_SECRET format");
    }
  });

  it("returns parsed event contract for valid signature", () => {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const event = {
      id: "evt_valid",
      type: "user.created",
      data: { id: "user_abc" },
    };
    const payloadText = JSON.stringify(event);
    const svixId = "msg_valid_signature";
    const timestamp = new Date();
    const svixTimestamp = String(Math.floor(timestamp.getTime() / 1000));
    const signer = new Webhook(secret);
    const svixSignature = signer.sign(svixId, timestamp, payloadText);

    const result = verifyClerkWebhookPayload({
      payloadText,
      svixId,
      svixTimestamp,
      svixSignature,
      webhookSecret: secret,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.eventId).toBe(event.id);
      expect(result.eventType).toBe(event.type);
      expect(result.data).toEqual(event.data);
    }
  });

  it("falls back to svix-id when payload omits event id", () => {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const event = {
      type: "user.updated",
      data: { id: "user_abc" },
    };
    const payloadText = JSON.stringify(event);
    const svixId = "msg_valid_without_payload_id";
    const timestamp = new Date();
    const svixTimestamp = String(Math.floor(timestamp.getTime() / 1000));
    const signer = new Webhook(secret);
    const svixSignature = signer.sign(svixId, timestamp, payloadText);

    const result = verifyClerkWebhookPayload({
      payloadText,
      svixId,
      svixTimestamp,
      svixSignature,
      webhookSecret: secret,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.eventId).toBe(svixId);
      expect(result.eventType).toBe("user.updated");
      expect(result.data).toEqual(event.data);
    }
  });

  it("accepts signing secrets wrapped in quotes", () => {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const event = {
      id: "evt_quoted_secret",
      type: "user.updated",
      data: { id: "user_abc" },
    };
    const payloadText = JSON.stringify(event);
    const svixId = "msg_quoted_secret";
    const timestamp = new Date();
    const svixTimestamp = String(Math.floor(timestamp.getTime() / 1000));
    const signer = new Webhook(secret);
    const svixSignature = signer.sign(svixId, timestamp, payloadText);

    const result = verifyClerkWebhookPayload({
      payloadText,
      svixId,
      svixTimestamp,
      svixSignature,
      webhookSecret: `"${secret}"`,
    });

    expect(result.success).toBe(true);
  });
});
