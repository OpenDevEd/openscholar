import { afterEach, describe, expect, it, vi } from "vitest";
import { requireLibraryRuntimeReady } from "./readinessClient";

const APPLICATION_UUID = "a1b2c3d4e5f6g7h8i9j0k1l2";
const RUNTIME_COMMIT = "a".repeat(40);
const REVISION = "revision-7";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readyVerifierBody() {
  return {
    applicationUuid: APPLICATION_UUID,
    commit: RUNTIME_COMMIT,
    ready: true,
    services: [
      "web",
      "search-indexer",
      "source-sync",
      "source-writeback",
      "publication-worker",
      "meilisearch",
    ].map((service) => ({ service })),
  };
}

function activeHealth(revision = REVISION) {
  return {
    state: "active",
    active: {
      schemaVersion: 1,
      revision,
      updatedAt: "2026-08-25T10:00:00.000Z",
    },
    rejected: null,
  };
}

function input(fetchImpl: typeof fetch) {
  return {
    applicationUuid: APPLICATION_UUID,
    runtimeCommit: RUNTIME_COMMIT,
    revisionKey: REVISION,
    targetBaseUrl: "https://climate.libraries.example.test",
    defaultLocale: "en-GB",
    verifierUrl: "https://runtime-verifier.example.test",
    verifierToken: "verifier-token-value",
    fetchImpl,
  };
}

describe("Evidence Library readiness client", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks the fixed verifier, active revision, public page, and admin page", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (request, init) => {
      const url = String(request);
      requests.push({ url, init });
      if (url.includes("runtime-verifier")) return json(readyVerifierBody());
      if (url.endsWith("/api/library-config/health")) {
        return json(activeHealth());
      }
      return new Response("ready", { status: 200 });
    });

    await expect(requireLibraryRuntimeReady(input(fetchImpl))).resolves.toEqual(
      { status: "ready" },
    );
    expect(requests.map(({ url }) => url)).toEqual([
      "https://runtime-verifier.example.test/v1/library-runtime/readiness",
      "https://climate.libraries.example.test/api/library-config/health",
      "https://climate.libraries.example.test/en-GB/lib",
      "https://climate.libraries.example.test/admin",
    ]);
    const verifierRequest = requests[0]!.init!;
    expect(verifierRequest.method).toBe("POST");
    expect(new Headers(verifierRequest.headers).get("authorization")).toBe(
      "Bearer verifier-token-value",
    );
    expect(JSON.parse(String(verifierRequest.body))).toEqual({
      applicationUuid: APPLICATION_UUID,
      commit: RUNTIME_COMMIT,
    });
    expect(requests.every(({ init }) => init?.redirect === "manual")).toBe(
      true,
    );
  });

  it("rejects a healthy runtime that activated another revision", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      if (String(request).includes("runtime-verifier")) {
        return json(readyVerifierBody());
      }
      return json(activeHealth("older-revision"));
    });

    await expect(
      requireLibraryRuntimeReady(input(fetchImpl)),
    ).rejects.toMatchObject({
      code: "CONFIG_NOT_READY",
      message: "The Evidence Library has not activated the requested revision",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not accept redirects from the public or admin route", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      const url = String(request);
      if (url.includes("runtime-verifier")) return json(readyVerifierBody());
      if (url.endsWith("/api/library-config/health")) {
        return json(activeHealth());
      }
      if (url.endsWith("/admin")) {
        return new Response(null, {
          status: 307,
          headers: { location: "https://other.example.test/login" },
        });
      }
      return new Response("ready", { status: 200 });
    });

    await expect(
      requireLibraryRuntimeReady(input(fetchImpl)),
    ).rejects.toMatchObject({
      code: "PAGE_NOT_READY",
      message: "The Evidence Library admin page is not ready",
    });
  });

  it("stops a readiness request after the fixed timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(
      async (_request, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const readiness = requireLibraryRuntimeReady(input(fetchImpl));
    const result = expect(readiness).rejects.toMatchObject({
      code: "READINESS_UNAVAILABLE",
      message: "Evidence Library readiness could not be checked",
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
  });
});
