import { describe, expect, it, vi } from "vitest";
import {
  classifyCustomHostnameStatus,
  CloudflareSaasError,
  createCloudflareSaasClient,
} from "./cloudflareSaasClient";

type Call = { url: string; method: string; body: unknown; headers: Headers };

function recordingFetch(reply: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    return reply(call);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function ok(result: unknown): Response {
  return Response.json({ success: true, errors: [], messages: [], result });
}

const CONFIG = { apiToken: "cf-token", zoneId: "zone123" };

describe("classifyCustomHostnameStatus", () => {
  it("is ready only when the certificate is active", () => {
    expect(classifyCustomHostnameStatus("active", "active")).toBe("active");
  });

  it("waits while the certificate is being issued", () => {
    for (const status of [
      "initializing",
      "pending_validation",
      "pending_issuance",
      "pending_deployment",
      "staging_deployment",
      "holding_deployment",
      "backup_issued",
    ]) {
      expect(classifyCustomHostnameStatus("pending", status)).toBe("pending");
    }
  });

  it("waits while the hostname is still being set up even with an active certificate", () => {
    expect(classifyCustomHostnameStatus("pending", "active")).toBe("pending");
  });

  it("fails when the certificate gave up or was withdrawn", () => {
    for (const status of [
      "validation_timed_out",
      "issuance_timed_out",
      "deployment_timed_out",
      "initializing_timed_out",
      "deletion_timed_out",
      "expired",
      "deleted",
      "inactive",
    ]) {
      expect(classifyCustomHostnameStatus("active", status)).toBe("failed");
    }
  });

  it("fails when the hostname itself is blocked or moved", () => {
    expect(classifyCustomHostnameStatus("blocked", "active")).toBe("failed");
    expect(classifyCustomHostnameStatus("moved", "active")).toBe("failed");
    expect(classifyCustomHostnameStatus("deleted", "pending_validation")).toBe("failed");
  });

  it("waits rather than failing on a status it does not know", () => {
    expect(classifyCustomHostnameStatus("pending", "something_new")).toBe("pending");
  });
});

describe("createCloudflareSaasClient", () => {
  it("creates a hostname with the library's own address as the origin", async () => {
    const { calls, fetchImpl } = recordingFetch(() =>
      ok({ id: "ch1", hostname: "evidence.example.org", status: "pending", ssl: { status: "pending_validation" } }),
    );
    const client = createCloudflareSaasClient({ ...CONFIG, fetchImpl });
    const result = await client.createCustomHostname({
      host: "evidence.example.org",
      originHost: "climate-lib.opendev.space",
    });

    expect(result).toEqual({
      hostnameId: "ch1",
      certificate: "pending",
      hostnameStatus: "pending",
      sslStatus: "pending_validation",
      validationErrors: [],
    });
    const call = calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(
      "https://api.cloudflare.com/client/v4/zones/zone123/custom_hostnames",
    );
    expect(call.headers.get("authorization")).toBe("Bearer cf-token");
    expect(call.body).toEqual({
      hostname: "evidence.example.org",
      custom_origin_server: "climate-lib.opendev.space",
      ssl: {
        method: "http",
        type: "dv",
        bundle_method: "ubiquitous",
        wildcard: false,
        settings: { min_tls_version: "1.2" },
      },
    });
  });

  it("reads a hostname back by name and returns nothing when it is gone", async () => {
    const { calls, fetchImpl } = recordingFetch((call) =>
      call.url.includes("hostname=evidence.example.org")
        ? ok([
            {
              id: "ch1",
              hostname: "evidence.example.org",
              status: "active",
              ssl: { status: "active" },
            },
          ])
        : ok([]),
    );
    const client = createCloudflareSaasClient({ ...CONFIG, fetchImpl });
    await expect(client.readCustomHostname("evidence.example.org")).resolves.toMatchObject({
      hostnameId: "ch1",
      certificate: "active",
    });
    await expect(client.readCustomHostname("other.example.org")).resolves.toBeNull();
    expect(calls[0]!.method).toBe("GET");
  });

  it("reports the reason a certificate could not be issued", async () => {
    const { fetchImpl } = recordingFetch(() =>
      ok([
        {
          id: "ch1",
          hostname: "evidence.example.org",
          status: "pending",
          ssl: {
            status: "pending_validation",
            validation_errors: [{ message: "caa_error: CAA record prevents issuance" }],
          },
        },
      ]),
    );
    const client = createCloudflareSaasClient({ ...CONFIG, fetchImpl });
    const read = await client.readCustomHostname("evidence.example.org");
    expect(read?.validationErrors).toEqual(["caa_error: CAA record prevents issuance"]);
  });

  it("deletes a hostname and treats an already-deleted one as done", async () => {
    const { calls, fetchImpl } = recordingFetch((call) =>
      call.url.endsWith("/ch404")
        ? Response.json({ success: false, errors: [{ code: 1436, message: "not found" }] }, { status: 404 })
        : ok({ id: "ch1" }),
    );
    const client = createCloudflareSaasClient({ ...CONFIG, fetchImpl });
    await expect(client.deleteCustomHostname("ch1")).resolves.toBeUndefined();
    await expect(client.deleteCustomHostname("ch404")).resolves.toBeUndefined();
    expect(calls.map((call) => call.method)).toEqual(["DELETE", "DELETE"]);
  });

  it("refuses a hostname the account will not accept", async () => {
    const { fetchImpl } = recordingFetch(() =>
      Response.json(
        { success: false, errors: [{ code: 1406, message: "hostname already exists" }] },
        { status: 409 },
      ),
    );
    const client = createCloudflareSaasClient({ ...CONFIG, fetchImpl });
    await expect(
      client.createCustomHostname({
        host: "evidence.example.org",
        originHost: "climate-lib.opendev.space",
      }),
    ).rejects.toBeInstanceOf(CloudflareSaasError);
  });

  it("refuses an answer that is not Cloudflare's", async () => {
    const { fetchImpl } = recordingFetch(() => new Response("<html>", { status: 200 }));
    const client = createCloudflareSaasClient({ ...CONFIG, fetchImpl });
    await expect(client.readCustomHostname("evidence.example.org")).rejects.toBeInstanceOf(
      CloudflareSaasError,
    );
  });
});
