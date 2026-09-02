import { afterEach, describe, expect, it, vi } from "vitest";
import {
  changeLibraryRuntimeRoute,
  classifyEvidenceLibraryAddress,
  handOffLibraryRuntime,
  isRetryableReadinessError,
  probeEvidenceLibraryAddress,
  removeLibraryRuntimeRoute,
  requireLibraryRuntimeReady,
} from "./readinessClient";

const APPLICATION_UUID = "a1b2c3d4e5f6g7h8i9j0k1l2";
const RUNTIME_COMMIT = "a".repeat(40);
const RUNTIME_IMAGE = `ghcr.io/opendeved/evidence-library-runtime@sha256:${"e".repeat(64)}`;
const REVISION = "revision-7";

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

function readyVerifierBody() {
  return {
    applicationUuid: APPLICATION_UUID,
    commit: RUNTIME_COMMIT,
    runtimeImage: RUNTIME_IMAGE,
    ready: true,
    services: [
      "web",
      "search-indexer",
      "source-sync",
      "source-writeback",
      "publication-worker",
      "meilisearch",
      "redis",
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

function activeHealthResponse(
  revision = REVISION,
  marker = `${RUNTIME_COMMIT}:${REVISION}`,
) {
  return json(activeHealth(revision), 200, { "X-OpenScholar-Route": marker });
}

const LOGIN_PAGE_URL =
  "https://app.example.test/evidence-libraries/kh74ezgjwdv2nkbq/admin";

function input(fetchImpl: typeof fetch) {
  return {
    applicationUuid: APPLICATION_UUID,
    runtimeCommit: RUNTIME_COMMIT,
    runtimeImage: RUNTIME_IMAGE,
    revisionKey: REVISION,
    targetBaseUrl: "https://climate.libraries.example.test",
    loginPageUrl: LOGIN_PAGE_URL,
    verifierUrl: "https://runtime-verifier.example.test",
    verifierToken: "verifier-token-value",
    fetchImpl,
  };
}

// The admin route answers in one of these ways; everything else means the
// library is not ready yet.
function adminAnswer(answer: Response) {
  return vi.fn<typeof fetch>(async (request) => {
    const url = String(request);
    if (url.includes("runtime-verifier")) return json(readyVerifierBody());
    if (url.endsWith("/api/library-config/health")) {
      return activeHealthResponse();
    }
    if (url.endsWith("/admin")) return answer.clone();
    return new Response("ready", { status: 200 });
  });
}

describe("Evidence Library readiness client", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["maintenance", "maintenance"],
    ["protection", "protected"],
    ["activation", "active"],
    ["finalization", "finalized"],
  ] as const)(
    "sends the fixed %s route contract",
    async (operation, status) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => json({ status }));

      await expect(
        changeLibraryRuntimeRoute(operation, {
          applicationUuid: APPLICATION_UUID,
          customOrigins: ["https://library.example.test"],
          platformOrigins: ["https://climate.libraries.example.test"],
          revisionKey: REVISION,
          runtimeCommit: RUNTIME_COMMIT,
          runtimeImage: RUNTIME_IMAGE,
          verifierUrl: "https://runtime-verifier.example.test",
          verifierToken: "verifier-token-value",
          fetchImpl,
        }),
      ).resolves.toEqual({ status });
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(String(url)).toBe(
        `https://runtime-verifier.example.test/v1/library-runtime/${operation}`,
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        applicationUuid: APPLICATION_UUID,
        commit: RUNTIME_COMMIT,
        customOrigins: ["https://library.example.test"],
        platformOrigins: ["https://climate.libraries.example.test"],
        revision: REVISION,
        runtimeImage: RUNTIME_IMAGE,
      });
    },
  );

  it("preserves a temporary route failure for the scheduled retry", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      json(
        {
          error: {
            code: "runtime_route_not_loaded",
            message: "The proxy has not loaded the route.",
          },
        },
        409,
      ),
    );

    const error = await changeLibraryRuntimeRoute("protection", {
      applicationUuid: APPLICATION_UUID,
      customOrigins: [],
      platformOrigins: ["https://climate.libraries.example.test"],
      revisionKey: REVISION,
      runtimeCommit: RUNTIME_COMMIT,
      runtimeImage: RUNTIME_IMAGE,
      verifierUrl: "https://runtime-verifier.example.test",
      verifierToken: "verifier-token-value",
      fetchImpl,
    }).then(
      () => null,
      (failure: unknown) => failure,
    );
    expect(error).toMatchObject({
      code: "RUNTIME_ROUTE_UNAVAILABLE",
      message:
        "Evidence Library traffic could not be updated: runtime_route_not_loaded: The proxy has not loaded the route.",
    });
    expect(isRetryableReadinessError(error)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("removes one library route with no caller-controlled runtime fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      json({ status: "removed" }),
    );

    await expect(
      removeLibraryRuntimeRoute({
        applicationUuid: APPLICATION_UUID,
        verifierUrl: "https://runtime-verifier.example.test",
        verifierToken: "verifier-token-value",
        fetchImpl,
      }),
    ).resolves.toEqual({ status: "removed" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://runtime-verifier.example.test/v1/library-runtime/removal",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      applicationUuid: APPLICATION_UUID,
    });
  });

  it("checks the fixed verifier, active revision, public page, and admin page", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (request, init) => {
      const url = String(request);
      requests.push({ url, init });
      if (url.includes("runtime-verifier")) return json(readyVerifierBody());
      if (url.endsWith("/api/library-config/health")) {
        return activeHealthResponse();
      }
      if (url.endsWith("/admin")) {
        return new Response(null, {
          status: 307,
          headers: { location: `${LOGIN_PAGE_URL}?return=%2Fadmin` },
        });
      }
      return new Response("ready", { status: 200 });
    });

    await expect(requireLibraryRuntimeReady(input(fetchImpl))).resolves.toEqual(
      { status: "ready" },
    );
    expect(requests.map(({ url }) => url)).toEqual([
      "https://runtime-verifier.example.test/v1/library-runtime/readiness",
      "https://climate.libraries.example.test/api/library-config/health",
      "https://climate.libraries.example.test/api/library-config/health",
      "https://climate.libraries.example.test/lib",
      "https://climate.libraries.example.test/admin",
    ]);
    expect(requests[3]!.init!.method).toBe("HEAD");
    const verifierRequest = requests[0]!.init!;
    expect(verifierRequest.method).toBe("POST");
    expect(new Headers(verifierRequest.headers).get("authorization")).toBe(
      "Bearer verifier-token-value",
    );
    expect(JSON.parse(String(verifierRequest.body))).toEqual({
      applicationUuid: APPLICATION_UUID,
      commit: RUNTIME_COMMIT,
      runtimeImage: RUNTIME_IMAGE,
    });
    expect(requests.every(({ init }) => init?.redirect === "manual")).toBe(
      true,
    );
  });

  it("passes the browser shield on every public readiness request", async () => {
    const targetOrigin = "https://evidence.example.org";
    const platformOrigin = "https://climate-lib.opendev.space";
    const seen: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(String(request));
      if (url.hostname === "runtime-verifier.example.test") {
        expect(new Headers(init?.headers).get("cookie")).toBeNull();
        return json(readyVerifierBody());
      }
      if (new Headers(init?.headers).get("cookie") !== "ode_browser_check=1") {
        return new Response("Forbidden", { status: 403 });
      }
      seen.push(url.href);
      if (url.pathname === "/api/library-config/health") {
        return activeHealthResponse();
      }
      if (url.origin === platformOrigin && url.pathname === "/lib") {
        return new Response(null, {
          status: 308,
          headers: { location: `${targetOrigin}/lib` },
        });
      }
      if (url.pathname === "/lib") {
        return new Response("ready", { status: 200 });
      }
      return new Response(null, {
        status: 307,
        headers: { location: LOGIN_PAGE_URL },
      });
    });

    await expect(
      requireLibraryRuntimeReady({
        ...input(fetchImpl),
        targetBaseUrl: targetOrigin,
        platformBaseUrl: platformOrigin,
      }),
    ).resolves.toEqual({ status: "ready" });
    expect(seen).toEqual([
      `${targetOrigin}/api/library-config/health`,
      `${targetOrigin}/api/library-config/health`,
      `${platformOrigin}/lib`,
      `${targetOrigin}/lib`,
      `${targetOrigin}/admin`,
    ]);
  });

  it("preserves the verifier reason when runtime services are not ready", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      json(
        {
          error: {
            code: "runtime_service_not_ready",
            message: "The web service is restarting.",
            service: "web",
          },
        },
        409,
      ),
    );

    await expect(
      requireLibraryRuntimeReady(input(fetchImpl)),
    ).rejects.toMatchObject({
      code: "RUNTIME_NOT_READY",
      message:
        "The Evidence Library services are not ready: runtime_service_not_ready: The web service is restarting. (web)",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a healthy runtime that activated another revision", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      if (String(request).includes("runtime-verifier")) {
        return json(readyVerifierBody());
      }
      return activeHealthResponse("older-revision");
    });

    const readiness = requireLibraryRuntimeReady(input(fetchImpl));
    const result = expect(readiness).rejects.toMatchObject({
      code: "CONFIG_NOT_READY",
      message: "The Evidence Library has not activated the requested revision",
    });
    await vi.runAllTimersAsync();
    await result;
    expect(fetchImpl).toHaveBeenCalledTimes(11);
  });

  it("waits for the proxy to apply the target runtime route", async () => {
    vi.useFakeTimers();
    let healthRequests = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      const url = String(request);
      if (url.includes("runtime-verifier")) {
        return json(readyVerifierBody());
      }
      if (url.endsWith("/api/library-config/health")) {
        healthRequests += 1;
        return activeHealthResponse(
          REVISION,
          healthRequests < 3
            ? `${"b".repeat(40)}:${REVISION}`
            : `${RUNTIME_COMMIT}:${REVISION}`,
        );
      }
      if (url.endsWith("/admin")) {
        return new Response(null, {
          status: 307,
          headers: { location: LOGIN_PAGE_URL },
        });
      }
      return new Response("ready", { status: 200 });
    });

    const readiness = requireLibraryRuntimeReady(input(fetchImpl));
    const result = expect(readiness).resolves.toEqual({ status: "ready" });
    await vi.runAllTimersAsync();
    await result;
    expect(healthRequests).toBe(3);
  });

  it("waits for the failover to serve the target revision", async () => {
    vi.useFakeTimers();
    let healthRequests = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      const url = String(request);
      if (url.includes("runtime-verifier")) {
        return json(readyVerifierBody());
      }
      if (url.endsWith("/api/library-config/health")) {
        healthRequests += 1;
        return activeHealthResponse(
          healthRequests < 3 ? "previous-revision" : REVISION,
        );
      }
      if (url.endsWith("/admin")) {
        return new Response(null, {
          status: 307,
          headers: { location: LOGIN_PAGE_URL },
        });
      }
      return new Response("ready", { status: 200 });
    });

    const readiness = requireLibraryRuntimeReady(input(fetchImpl));
    await vi.runAllTimersAsync();
    await expect(readiness).resolves.toEqual({ status: "ready" });
    expect(healthRequests).toBe(4);
  });

  it("stops waiting when the proxy does not apply the target runtime route", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      if (String(request).includes("runtime-verifier")) {
        return json(readyVerifierBody());
      }
      return activeHealthResponse(REVISION, `${"b".repeat(40)}:${REVISION}`);
    });

    const readiness = requireLibraryRuntimeReady(input(fetchImpl));
    const result = expect(readiness).rejects.toMatchObject({
      code: "CONFIG_NOT_READY",
      message: "The Evidence Library traffic route is not active",
    });
    await vi.runAllTimersAsync();
    await result;
    expect(fetchImpl).toHaveBeenCalledTimes(12);
  });

  it("accepts the admin route sending a signed-out visitor to this library's login page", async () => {
    const fetchImpl = adminAnswer(
      new Response(null, {
        status: 307,
        headers: { location: `${LOGIN_PAGE_URL}?return=%2Fadmin` },
      }),
    );

    await expect(requireLibraryRuntimeReady(input(fetchImpl))).resolves.toEqual(
      { status: "ready" },
    );
  });

  it.each([
    {
      label: "a redirect to somewhere else",
      answer: new Response(null, {
        status: 307,
        headers: { location: "https://other.example.test/login" },
      }),
    },
    {
      label: "a redirect to another library's login page",
      answer: new Response(null, {
        status: 307,
        headers: {
          location:
            "https://app.example.test/evidence-libraries/another-library/admin",
        },
      }),
    },
    {
      label: "a redirect with no address",
      answer: new Response(null, { status: 307 }),
    },
    {
      label: "a server error",
      answer: new Response("boom", { status: 502 }),
    },
    ...[301, 302, 303, 308].map((status) => ({
      label: `a ${status} to the right login page`,
      answer: new Response(null, {
        status,
        headers: { location: LOGIN_PAGE_URL },
      }),
    })),
    {
      label: "a page of its own",
      answer: new Response("<!doctype html><title>Admin</title>", {
        status: 200,
      }),
    },
    {
      label: "a redirect to an address that only starts the same",
      answer: new Response(null, {
        status: 307,
        headers: { location: `${LOGIN_PAGE_URL}-evil` },
      }),
    },
    {
      label: "a redirect to the login page on another site",
      answer: new Response(null, {
        status: 307,
        headers: {
          location: LOGIN_PAGE_URL.replace(
            "app.example.test",
            "app.example.test.evil.example",
          ),
        },
      }),
    },
    {
      label: "a redirect to a path below the login page",
      answer: new Response(null, {
        status: 307,
        headers: { location: `${LOGIN_PAGE_URL}/deeper` },
      }),
    },
  ])("refuses the admin route answering with $label", async ({ answer }) => {
    await expect(
      requireLibraryRuntimeReady(input(adminAnswer(answer))),
    ).rejects.toMatchObject({
      code: "PAGE_NOT_READY",
      message: "The Evidence Library admin page is not ready",
    });
  });

  it("does not accept a redirect from the public page", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      const url = String(request);
      if (url.includes("runtime-verifier")) return json(readyVerifierBody());
      if (url.endsWith("/api/library-config/health")) {
        return activeHealthResponse();
      }
      if (url.endsWith("/lib")) {
        return new Response(null, {
          status: 307,
          headers: { location: LOGIN_PAGE_URL },
        });
      }
      return new Response("ready", { status: 200 });
    });

    await expect(
      requireLibraryRuntimeReady(input(fetchImpl)),
    ).rejects.toMatchObject({
      code: "PAGE_NOT_READY",
      message: "The Evidence Library public page is not ready",
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

  it("waits for the new route before checking its active revision", async () => {
    vi.useFakeTimers();
    let finalized = false;
    let healthRequests = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      const url = String(request);
      if (url.endsWith("/v1/library-runtime/readiness")) {
        return json(readyVerifierBody());
      }
      if (url.endsWith("/v1/library-runtime/activation")) {
        return json({ status: "active" });
      }
      if (url.endsWith("/v1/library-runtime/finalization")) {
        finalized = true;
        return json({ status: "finalized" });
      }
      if (url.endsWith("/api/library-config/health")) {
        healthRequests += 1;
        if (finalized) return json(activeHealth());
        return new Response(null, {
          status: 308,
          headers: {
            location: "https://climate.libraries.example.test/",
            "X-OpenScholar-Route":
              healthRequests === 1
                ? `${"b".repeat(40)}:previous-revision`
                : `${RUNTIME_COMMIT}:${REVISION}`,
          },
        });
      }
      if (url.endsWith("/admin")) {
        return new Response(null, {
          status: 307,
          headers: { location: LOGIN_PAGE_URL },
        });
      }
      return new Response("ready", { status: 200 });
    });

    const readiness = handOffLibraryRuntime(
      {
        applicationUuid: APPLICATION_UUID,
        customOrigins: ["https://climate.libraries.example.test"],
        platformOrigins: ["https://climate-lib.opendev.space"],
        revisionKey: REVISION,
        runtimeCommit: RUNTIME_COMMIT,
        runtimeImage: RUNTIME_IMAGE,
        verifierUrl: "https://runtime-verifier.example.test",
        verifierToken: "verifier-token-value",
        fetchImpl,
      },
      input(fetchImpl),
    );
    const result = expect(readiness).resolves.toEqual({ status: "ready" });
    await vi.runAllTimersAsync();
    await result;
    expect(finalized).toBe(true);
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
    expect(
      classifyEvidenceLibraryAddress({ kind: "unreachable" }),
    ).toMatchObject({ state: "unreachable" });
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

  it("reads an exact route-marked redirect as ours", () => {
    expect(
      classifyEvidenceLibraryAddress(
        {
          kind: "answer",
          status: 308,
          body: "",
          runtimeRoute: `${RUNTIME_COMMIT}:${REVISION}`,
        },
        { runtimeCommit: RUNTIME_COMMIT, revisionKey: REVISION },
      ),
    ).toEqual({
      state: "ours",
      revision: REVISION,
      activeAndAccepted: true,
    });
  });

  it("rejects a redirect carrying another library route", () => {
    expect(
      classifyEvidenceLibraryAddress(
        {
          kind: "answer",
          status: 308,
          body: "",
          runtimeRoute: `${RUNTIME_COMMIT}:another-revision`,
        },
        { runtimeCommit: RUNTIME_COMMIT, revisionKey: REVISION },
      ),
    ).toMatchObject({ state: "not-ours" });
  });

  it("probes the health route of a live library address", async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      requests.push(String(request));
      return activeHealthResponse("revision-12");
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

  it("keeps the verifier and the platform address off the pinned client", async () => {
    // The pinned client can only reach the library's own address. Sending
    // the verifier or the platform address through it would refuse every
    // readiness check for a custom domain.
    const seen: { pinned: string[]; ordinary: string[] } = {
      pinned: [],
      ordinary: [],
    };
    const record = (bucket: string[]) =>
      (async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        bucket.push(url.hostname);
        if (url.pathname === "/api/library-config/health") {
          return activeHealthResponse();
        }
        if (url.pathname.startsWith("/v1/library-runtime")) {
          return Response.json(readyVerifierBody());
        }
        if (url.pathname === "/lib")
          return new Response("<html>", { status: 200 });
        if (url.pathname === "/admin") {
          return new Response("", {
            status: 302,
            headers: { location: LOGIN_PAGE_URL },
          });
        }
        return new Response("", {
          status: 308,
          headers: { location: "https://evidence.example.org/" },
        });
      }) as unknown as typeof fetch;

    await requireLibraryRuntimeReady({
      ...input(record(seen.ordinary)),
      targetBaseUrl: "https://evidence.example.org",
      platformBaseUrl: "https://climate-lib.opendev.space",
      targetFetchImpl: record(seen.pinned),
    }).catch(() => undefined);

    // Everything the pinned client saw was the library's own address.
    expect([...new Set(seen.pinned)]).toEqual(["evidence.example.org"]);
    // The verifier and the platform address went the ordinary way.
    expect(seen.ordinary).toContain("runtime-verifier.example.test");
    expect(seen.ordinary).toContain("climate-lib.opendev.space");
  });

  it("gives up on a library that sends headers and then stops", async () => {
    // The deadline used to end when the headers arrived, so a body that
    // never finished held the check open for ever.
    vi.useFakeTimers();
    try {
      const fetchImpl = (async (
        _url: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const signal = init?.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"state":'));
              // Nothing more is ever sent.
              signal?.addEventListener("abort", () => {
                controller.error(new Error("aborted"));
              });
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const pending = probeEvidenceLibraryAddress({
        targetBaseUrl: "https://climate.libraries.example.test",
        fetchImpl,
      });
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(pending).resolves.toMatchObject({ state: "unreachable" });
    } finally {
      vi.useRealTimers();
    }
  });
});
