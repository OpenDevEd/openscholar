import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyEvidenceLibraryAddress,
  probeEvidenceLibraryAddress,
  requireLibraryRuntimeReady,
} from "./readinessClient";

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
      "https://climate.libraries.example.test/lib",
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

  it("reports an address served by another site instead of waiting", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      if (String(request).includes("runtime-verifier")) {
        return json(readyVerifierBody());
      }
      return new Response("<!doctype html><title>Another site</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    await expect(
      requireLibraryRuntimeReady(input(fetchImpl)),
    ).rejects.toMatchObject({
      code: "ADDRESS_NOT_OURS",
      message: "Another site answers this Evidence Library address",
    });
  });

  it("treats a redirect away from the address as another site", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      if (String(request).includes("runtime-verifier")) {
        return json(readyVerifierBody());
      }
      return new Response(null, {
        status: 307,
        headers: { location: "https://docs.example.test/" },
      });
    });

    await expect(
      requireLibraryRuntimeReady(input(fetchImpl)),
    ).rejects.toMatchObject({ code: "ADDRESS_NOT_OURS" });
  });

  it("keeps waiting while the proxy has no server for the address", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      if (String(request).includes("runtime-verifier")) {
        return json(readyVerifierBody());
      }
      return new Response("no available server", { status: 503 });
    });

    await expect(
      requireLibraryRuntimeReady(input(fetchImpl)),
    ).rejects.toMatchObject({ code: "CONFIG_NOT_READY" });
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

describe("Evidence Library address ownership", () => {
  it("reads our own health answer as ours and keeps the revision", () => {
    expect(
      classifyEvidenceLibraryAddress({
        kind: "answer",
        status: 200,
        body: JSON.stringify(activeHealth()),
      }),
    ).toEqual({ state: "ours", revision: REVISION, activeAndAccepted: true });
  });

  it("still reads our health answer as ours while it rejects a revision", () => {
    expect(
      classifyEvidenceLibraryAddress({
        kind: "answer",
        status: 200,
        body: JSON.stringify({
          state: "rejected",
          active: null,
          rejected: { revision: "revision-8", reason: "invalid" },
        }),
      }),
    ).toEqual({ state: "ours", revision: null, activeAndAccepted: false });
  });

  it("reads the free-address signal as nothing serving the host yet", () => {
    expect(
      classifyEvidenceLibraryAddress({
        kind: "answer",
        status: 503,
        body: "no available server",
      }),
    ).toMatchObject({ state: "unreachable" });
  });

  it("reads a network failure as unreachable", () => {
    expect(classifyEvidenceLibraryAddress({ kind: "unreachable" })).toMatchObject(
      { state: "unreachable" },
    );
  });

  it.each([
    ["a page from another site", 200, "<!doctype html><html></html>"],
    ["another API answering JSON", 200, JSON.stringify({ ok: true })],
    ["a redirect", 307, ""],
    ["another site's not-found page", 404, "Not found"],
    ["another server's error page", 502, "Bad gateway"],
  ])("reads %s as not ours", (_label, status, body) => {
    expect(
      classifyEvidenceLibraryAddress({ kind: "answer", status, body }),
    ).toMatchObject({ state: "not-ours" });
  });

  it("probes the health route of a live library address", async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      requests.push(String(request));
      return json(activeHealth("revision-12"));
    });

    expect(
      await probeEvidenceLibraryAddress({
        targetBaseUrl: "https://climate.libraries.example.test",
        fetchImpl,
      }),
    ).toMatchObject({ state: "ours", revision: "revision-12" });
    expect(requests).toEqual([
      "https://climate.libraries.example.test/api/library-config/health",
    ]);
  });

  it("probes an unreachable address without throwing", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    expect(
      await probeEvidenceLibraryAddress({
        targetBaseUrl: "https://gone.libraries.example.test",
        fetchImpl,
      }),
    ).toMatchObject({ state: "unreachable" });
  });
});
