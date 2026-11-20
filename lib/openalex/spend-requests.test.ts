import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));
let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));

const { spendOpenAlexRequests } = await import("./spend-requests");
const { OPENALEX_REQUEST_LIMITS } = await import("./request-limiter");

describe("spendOpenAlexRequests for signed-out visitors", () => {
  beforeEach(() => { requestHeaders = new Headers({ "cf-connecting-ip": "203.0.113.7" }); });

  it("never limits a crawler Cloudflare has verified, whose few addresses would spend a visitor's day", async () => {
    requestHeaders.set("x-openscholar-verified-bot", "true");
    expect(await spendOpenAlexRequests(OPENALEX_REQUEST_LIMITS.visitor.perMinute)).toBeNull();
    expect(await spendOpenAlexRequests(OPENALEX_REQUEST_LIMITS.visitor.perMinute)).toBeNull();
  });

  it("still limits anyone else from that address", async () => {
    expect(await spendOpenAlexRequests(OPENALEX_REQUEST_LIMITS.visitor.perMinute)).toBeNull();
    expect(await spendOpenAlexRequests(1)).not.toBeNull();
  });
});
