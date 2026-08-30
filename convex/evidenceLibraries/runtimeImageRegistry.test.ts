/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { resolveRuntimeImage } from "./runtimeImageRegistry";

const COMMIT = "9dd3e7b36ca8b29dace3fdcaffb9ecc833932d09";
const DIGEST =
  "sha256:eca9917bdd28bd4691242553b3b8f5c012077e3d4daafef976c7bee4b304feb3";
const MANIFEST_URL = `https://ghcr.io/v2/opendeved/evidence-library-runtime/manifests/${COMMIT}`;
const CHALLENGE =
  'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:opendeved/evidence-library-runtime:pull"';

type RecordedRequest = {
  url: string;
  method: string;
  headers: Headers;
};

function response(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function registryFetch() {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = vi.fn(
    async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      const headers = new Headers(init?.headers);
      requests.push({
        url,
        method: init?.method ?? "GET",
        headers,
      });
      if (url === MANIFEST_URL && requests.length === 1) {
        return response(null, 401, { "www-authenticate": CHALLENGE });
      }
      if (url === "https://api.github.com/user") {
        return response({ login: "sickerine" });
      }
      if (url.startsWith("https://ghcr.io/token?")) {
        return response({ token: "short-lived-bearer" });
      }
      if (
        url === MANIFEST_URL &&
        headers.get("authorization") === "Bearer short-lived-bearer"
      ) {
        return response(null, 200, { "docker-content-digest": DIGEST });
      }
      return response({ message: "unexpected request" }, 500);
    },
  );
  return { fetchImpl, requests };
}

describe("runtime image registry", () => {
  it("resolves a private commit tag to one immutable digest reference", async () => {
    const registry = registryFetch();

    await expect(
      resolveRuntimeImage({
        commit: COMMIT,
        githubToken: "github-token",
        fetchImpl: registry.fetchImpl,
      }),
    ).resolves.toBe(`ghcr.io/opendeved/evidence-library-runtime@${DIGEST}`);

    expect(
      registry.requests.map(({ url, method }) => ({ url, method })),
    ).toEqual([
      { url: MANIFEST_URL, method: "HEAD" },
      { url: "https://api.github.com/user", method: "GET" },
      {
        url: "https://ghcr.io/token?service=ghcr.io&scope=repository%3Aopendeved%2Fevidence-library-runtime%3Apull",
        method: "GET",
      },
      { url: MANIFEST_URL, method: "HEAD" },
    ]);
    expect(registry.requests[0]?.headers.get("accept")).toContain(
      "application/vnd.oci.image.index.v1+json",
    );
    expect(registry.requests[1]?.headers.get("authorization")).toBe(
      "Bearer github-token",
    );
    expect(registry.requests[2]?.headers.get("authorization")).toBe(
      `Basic ${btoa("sickerine:github-token")}`,
    );
  });

  it("returns null while a green commit has no published image", async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => response(null, 404));

    await expect(
      resolveRuntimeImage({
        commit: COMMIT,
        githubToken: "github-token",
        fetchImpl,
      }),
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects an unexpected authentication challenge", async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      response(null, 401, {
        "www-authenticate":
          'Bearer realm="https://example.com/token",service="ghcr.io",scope="repository:opendeved/evidence-library-runtime:pull"',
      }),
    );

    await expect(
      resolveRuntimeImage({
        commit: COMMIT,
        githubToken: "github-token",
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: "REGISTRY_INVALID_RESPONSE",
    });
  });

  it("rejects a response without an exact sha256 digest", async () => {
    const registry = registryFetch();
    vi.mocked(registry.fetchImpl).mockImplementationOnce(async () =>
      response(null, 200, { "docker-content-digest": "sha256:not-a-digest" }),
    );

    await expect(
      resolveRuntimeImage({
        commit: COMMIT,
        githubToken: "github-token",
        fetchImpl: registry.fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: "REGISTRY_INVALID_RESPONSE",
    });
  });

  it("validates the commit and token before making a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      resolveRuntimeImage({
        commit: "main",
        githubToken: "github-token",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "REGISTRY_INVALID_COMMIT" });
    await expect(
      resolveRuntimeImage({ commit: COMMIT, githubToken: " ", fetchImpl }),
    ).rejects.toMatchObject({ code: "GITHUB_TOKEN_MISSING" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
