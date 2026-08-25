import { createHash } from "node:crypto";
import type { Id } from "../_generated/dataModel";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CoolifyClientError,
  createCoolifyClient,
  createCoolifyLibraryTag,
} from "./coolifyClient";

const COOLIFY_ORIGIN = "https://coolify.example.test";
const COOLIFY_TOKEN = "coolify-token";
const LIBRARY_ID =
  "j575gwm9tffaeghzu0rwqc9g196b09zb" as Id<"evidenceLibraries">;
const APPLICATION_UUID = "app000000000000000000001";
const SERVER_UUID = "server00000000000000001";
const PROJECT_UUID = "project0000000000000001";
const GITHUB_APP_UUID = "github00000000000000001";
const GITHUB_APP_ID = 7;
const ENVIRONMENT_NAME = "development";
const RUNTIME_COMMIT = "a".repeat(40);
const OTHER_COMMIT = "b".repeat(40);
const PUBLIC_DOMAIN = "https://library.example.test";
const LIBRARY_CONFIG_JSON = JSON.stringify({
  revision: "rev-1",
  services: { search: { host: "http://meilisearch:7700" } },
});
const MEILISEARCH_MASTER_KEY = "meilisearch-key";

type FakeApplication = {
  id: number;
  uuid: string;
  name: string;
  config_hash: string;
  git_repository: string;
  git_branch: string;
  git_commit_sha: string;
  build_pack: string;
  ports_exposes: string;
  fqdn: string | null;
  docker_compose_location: string;
  docker_compose_domains: string | null;
  source_type: string | null;
  source_id: number | null;
  environment: {
    name: string;
    project: { uuid: string };
  };
  destination: { server: { uuid: string } };
  settings: {
    is_auto_deploy_enabled: boolean;
    is_preview_deployments_enabled: boolean;
    connect_to_docker_network: boolean;
    inject_build_args_to_dockerfile: boolean;
    include_source_commit_in_build: boolean;
  };
};

type FakeEnvironment = {
  uuid: string;
  key: string;
  value: string;
  is_preview: boolean;
  is_literal: boolean;
  is_multiline: boolean;
  is_shown_once: boolean;
  is_runtime: boolean;
  is_buildtime: boolean;
  is_coolify: boolean;
  is_buildpack_control: boolean;
  is_shared: boolean;
  comment: string | null;
};

type FakeDeployment = {
  application_id: string;
  deployment_uuid: string;
  commit: string;
  configuration_hash?: string | null;
  status: string;
};

type RecordedRequest = {
  body: unknown;
  headers: Headers;
  method: string;
  path: string;
  search: string;
  signal: AbortSignal | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function hashForRevision(revision: number): string {
  return revision.toString(16).padStart(64, "0");
}

function expectedApplication(
  overrides: Partial<FakeApplication> = {},
): FakeApplication {
  return {
    id: 42,
    uuid: APPLICATION_UUID,
    name: createCoolifyLibraryTag(LIBRARY_ID),
    config_hash: hashForRevision(1),
    git_repository: "OpenDevEd/new-el",
    git_branch: "main",
    git_commit_sha: RUNTIME_COMMIT,
    build_pack: "dockercompose",
    ports_exposes: "80",
    fqdn: null,
    docker_compose_location: "/docker/compose.library.yaml",
    docker_compose_domains: JSON.stringify({
      web: { domain: PUBLIC_DOMAIN },
    }),
    source_type: "App\\Models\\GithubApp",
    source_id: GITHUB_APP_ID,
    environment: {
      name: ENVIRONMENT_NAME,
      project: { uuid: PROJECT_UUID },
    },
    destination: { server: { uuid: SERVER_UUID } },
    settings: {
      is_auto_deploy_enabled: false,
      is_preview_deployments_enabled: false,
      connect_to_docker_network: false,
      inject_build_args_to_dockerfile: false,
      include_source_commit_in_build: false,
    },
    ...structuredClone(overrides),
  };
}

function environment(
  key: string,
  value: string,
  overrides: Partial<FakeEnvironment> = {},
): FakeEnvironment {
  return {
    uuid: `env-${key.toLowerCase().replaceAll("_", "-")}-production`,
    key,
    value,
    is_preview: false,
    is_literal: true,
    is_multiline: false,
    is_shown_once: false,
    is_runtime: true,
    is_buildtime: true,
    is_coolify: false,
    is_buildpack_control: false,
    is_shared: false,
    comment: null,
    ...overrides,
  };
}

function createCoolifyServer(
  input: {
    application?: FakeApplication;
    tags?: string[];
    environments?: FakeEnvironment[];
    deployments?: FakeDeployment[];
    deploymentCount?: number;
    ignoreApplicationWrites?: boolean;
    ignoreEnvironmentWrites?: boolean;
  } = {},
) {
  let revision = 1;
  let application = input.application
    ? structuredClone(input.application)
    : null;
  const tags = new Set(input.tags ?? []);
  let environments = structuredClone(input.environments ?? []);
  const deployments = structuredClone(input.deployments ?? []);
  const requests: RecordedRequest[] = [];

  function bumpConfigHash(): void {
    if (!application) return;
    revision += 1;
    application.config_hash = hashForRevision(revision);
  }

  const fetchImpl: typeof fetch = vi.fn(
    async (requestInput: RequestInfo | URL, init?: RequestInit) => {
      const request = requestInput instanceof Request ? requestInput : null;
      const url = new URL(
        typeof requestInput === "string"
          ? requestInput
          : requestInput instanceof URL
            ? requestInput.href
            : requestInput.url,
      );
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const headers = new Headers(init?.headers ?? request?.headers);
      requests.push({
        body,
        headers,
        method,
        path: url.pathname,
        search: url.search,
        signal: init?.signal ?? null,
      });

      if (headers.get("authorization") !== `Bearer ${COOLIFY_TOKEN}`) {
        return jsonResponse({ message: "Unauthenticated" }, 401);
      }

      if (method === "GET" && url.pathname === "/api/v1/github-apps") {
        return jsonResponse([
          { id: GITHUB_APP_ID, uuid: GITHUB_APP_UUID, name: "OpenDevEd" },
        ]);
      }

      if (method === "GET" && url.pathname === "/api/v1/applications") {
        const tag = url.searchParams.get("tag");
        return jsonResponse(
          application && tag && tags.has(tag)
            ? [structuredClone(application)]
            : [],
        );
      }

      if (
        method === "POST" &&
        url.pathname === "/api/v1/applications/private-github-app"
      ) {
        const create = body as Record<string, unknown>;
        if (!input.ignoreApplicationWrites) {
          const composeDomains = create.docker_compose_domains as Array<{
            name: string;
            domain: string;
          }>;
          application = expectedApplication({
            name: String(create.name),
            git_repository: String(create.git_repository),
            git_branch: String(create.git_branch),
            git_commit_sha: String(create.git_commit_sha),
            build_pack: String(create.build_pack),
            ports_exposes: String(create.ports_exposes),
            docker_compose_location: String(create.docker_compose_location),
            docker_compose_domains: JSON.stringify(
              Object.fromEntries(
                composeDomains.map(({ name, domain }) => [name, { domain }]),
              ),
            ),
            settings: {
              is_auto_deploy_enabled: Boolean(create.is_auto_deploy_enabled),
              is_preview_deployments_enabled: Boolean(
                create.is_preview_deployments_enabled,
              ),
              connect_to_docker_network: Boolean(
                create.connect_to_docker_network,
              ),
              inject_build_args_to_dockerfile: Boolean(
                create.inject_build_args_to_dockerfile,
              ),
              include_source_commit_in_build: Boolean(
                create.include_source_commit_in_build,
              ),
            },
          });
          for (const tag of create.tags as string[]) tags.add(tag);
        }
        return jsonResponse({ uuid: APPLICATION_UUID }, 201);
      }

      const applicationPath = `/api/v1/applications/${APPLICATION_UUID}`;
      if (method === "GET" && url.pathname === applicationPath) {
        return application
          ? jsonResponse(structuredClone(application))
          : jsonResponse({ message: "Application not found" }, 404);
      }

      if (method === "PATCH" && url.pathname === applicationPath) {
        if (!application) return jsonResponse({ message: "Not found" }, 404);
        if (!input.ignoreApplicationWrites) {
          const patch = body as Record<string, unknown>;
          for (const key of [
            "name",
            "git_repository",
            "git_branch",
            "git_commit_sha",
            "build_pack",
            "ports_exposes",
            "docker_compose_location",
          ] as const) {
            if (key in patch) {
              (application as unknown as Record<string, unknown>)[key] =
                patch[key];
            }
          }
          if (Array.isArray(patch.docker_compose_domains)) {
            application.docker_compose_domains = JSON.stringify(
              Object.fromEntries(
                (
                  patch.docker_compose_domains as Array<{
                    name: string;
                    domain: string;
                  }>
                ).map(({ name, domain }) => [name, { domain }]),
              ),
            );
          }
          for (const key of [
            "is_auto_deploy_enabled",
            "is_preview_deployments_enabled",
            "connect_to_docker_network",
            "inject_build_args_to_dockerfile",
            "include_source_commit_in_build",
          ] as const) {
            if (key in patch) application.settings[key] = Boolean(patch[key]);
          }
          bumpConfigHash();
        }
        return jsonResponse({ uuid: APPLICATION_UUID });
      }

      if (url.pathname === `${applicationPath}/tags`) {
        if (method === "GET") {
          return jsonResponse(
            [...tags].map((name, index) => ({ uuid: `tag-${index}`, name })),
          );
        }
        if (method === "POST") {
          if (!input.ignoreApplicationWrites) {
            const tagName = (body as { tag_name: string }).tag_name;
            tags.add(tagName);
          }
          return jsonResponse(
            [...tags].map((name, index) => ({ uuid: `tag-${index}`, name })),
            201,
          );
        }
      }

      if (url.pathname === `${applicationPath}/envs`) {
        if (method === "GET")
          return jsonResponse(structuredClone(environments));
        const write = body as Omit<
          FakeEnvironment,
          "uuid" | "is_coolify" | "is_buildpack_control" | "is_shared"
        >;
        if (!input.ignoreEnvironmentWrites) {
          if (method === "POST") {
            environments.push(
              environment(write.key, write.value, {
                ...write,
                uuid: `env-created-${environments.length + 1}`,
              }),
            );
          } else if (method === "PATCH") {
            environments = environments.map((current) =>
              current.key === write.key &&
              current.is_preview === write.is_preview
                ? { ...current, ...write }
                : current,
            );
          }
          bumpConfigHash();
        }
        const saved = environments.find(
          (current) =>
            current.key === write.key &&
            current.is_preview === write.is_preview,
        );
        return jsonResponse(
          saved ?? { uuid: "ignored-write", key: write.key },
          201,
        );
      }

      const envDeletePrefix = `${applicationPath}/envs/`;
      if (method === "DELETE" && url.pathname.startsWith(envDeletePrefix)) {
        const envUuid = decodeURIComponent(
          url.pathname.slice(envDeletePrefix.length),
        );
        if (!input.ignoreEnvironmentWrites) {
          environments = environments.filter(({ uuid }) => uuid !== envUuid);
          bumpConfigHash();
        }
        return jsonResponse({ message: "Environment variable deleted" });
      }

      if (
        method === "GET" &&
        url.pathname === `/api/v1/deployments/applications/${APPLICATION_UUID}`
      ) {
        return jsonResponse({
          count: input.deploymentCount ?? deployments.length,
          deployments: structuredClone(deployments),
        });
      }

      if (method === "POST" && url.pathname === "/api/v1/deploy") {
        const deploymentUuid = `deployment-started-${deployments.length + 1}`;
        deployments.unshift({
          application_id: "42",
          deployment_uuid: deploymentUuid,
          commit: application?.git_commit_sha ?? RUNTIME_COMMIT,
          configuration_hash: application?.config_hash ?? hashForRevision(1),
          status: "queued",
        });
        return jsonResponse({
          deployments: [
            {
              message: "Deployment started",
              resource_uuid: url.searchParams.get("uuid"),
              deployment_uuid: deploymentUuid,
            },
          ],
        });
      }

      const deploymentPathPrefix = "/api/v1/deployments/";
      if (method === "GET" && url.pathname.startsWith(deploymentPathPrefix)) {
        const deploymentUuid = decodeURIComponent(
          url.pathname.slice(deploymentPathPrefix.length),
        );
        const deployment = deployments.find(
          (candidate) => candidate.deployment_uuid === deploymentUuid,
        );
        return deployment
          ? jsonResponse(structuredClone(deployment))
          : jsonResponse({ message: "Deployment not found" }, 404);
      }

      return jsonResponse({ message: "Unexpected test request" }, 500);
    },
  );

  return {
    fetchImpl,
    requests,
    get application() {
      return application;
    },
    get environments() {
      return environments;
    },
    tags,
    deployments,
  };
}

function createClient(fetchImpl: typeof fetch) {
  return createCoolifyClient({
    origin: COOLIFY_ORIGIN,
    token: COOLIFY_TOKEN,
    fetchImpl,
  });
}

function reconcileInput() {
  return {
    libraryId: LIBRARY_ID,
    serverUuid: SERVER_UUID,
    projectUuid: PROJECT_UUID,
    environmentName: ENVIRONMENT_NAME,
    githubAppUuid: GITHUB_APP_UUID,
    runtimeCommit: RUNTIME_COMMIT,
    publicDomain: PUBLIC_DOMAIN,
    libraryConfigJson: LIBRARY_CONFIG_JSON,
    meilisearchMasterKey: MEILISEARCH_MASTER_KEY,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Coolify Evidence Library client", () => {
  it("creates one fixed Compose app, writes only the two runtime values, and reads everything back", async () => {
    const server = createCoolifyServer();
    const client = createClient(server.fetchImpl);

    const result = await client.reconcileApplication(reconcileInput());

    expect(result).toEqual({
      outcome: "created",
      applicationUuid: APPLICATION_UUID,
      applicationTag: createCoolifyLibraryTag(LIBRARY_ID),
      runtimeConfigSha256: createHash("sha256")
        .update(LIBRARY_CONFIG_JSON)
        .digest("hex"),
      coolifyConfigHash: server.application?.config_hash,
    });
    expect(server.application).toMatchObject({
      uuid: APPLICATION_UUID,
      name: createCoolifyLibraryTag(LIBRARY_ID),
      git_repository: "OpenDevEd/new-el",
      git_branch: "main",
      git_commit_sha: RUNTIME_COMMIT,
      build_pack: "dockercompose",
      ports_exposes: "80",
      fqdn: null,
      docker_compose_location: "/docker/compose.library.yaml",
      source_type: "App\\Models\\GithubApp",
      source_id: GITHUB_APP_ID,
      environment: {
        name: ENVIRONMENT_NAME,
        project: { uuid: PROJECT_UUID },
      },
      destination: { server: { uuid: SERVER_UUID } },
      settings: {
        is_auto_deploy_enabled: false,
        is_preview_deployments_enabled: false,
        connect_to_docker_network: false,
        inject_build_args_to_dockerfile: false,
        include_source_commit_in_build: false,
      },
    });
    expect(
      JSON.parse(server.application?.docker_compose_domains ?? "null"),
    ).toEqual({ web: { domain: PUBLIC_DOMAIN } });
    expect(server.tags).toEqual(new Set([createCoolifyLibraryTag(LIBRARY_ID)]));
    expect(
      server.environments.map((value) => ({
        key: value.key,
        value: value.value,
        is_preview: value.is_preview,
        is_literal: value.is_literal,
        is_runtime: value.is_runtime,
        is_buildtime: value.is_buildtime,
      })),
    ).toEqual([
      {
        key: "LIBRARY_CONFIG_JSON",
        value: LIBRARY_CONFIG_JSON,
        is_preview: false,
        is_literal: true,
        is_runtime: true,
        is_buildtime: true,
      },
      {
        key: "MEILISEARCH_MASTER_KEY",
        value: MEILISEARCH_MASTER_KEY,
        is_preview: false,
        is_literal: true,
        is_runtime: true,
        is_buildtime: true,
      },
    ]);

    const listRequest = server.requests.find(
      ({ method, path }) => method === "GET" && path === "/api/v1/applications",
    );
    expect(new URLSearchParams(listRequest?.search).get("tag")).toBe(
      createCoolifyLibraryTag(LIBRARY_ID),
    );
    const createRequest = server.requests.find(
      ({ method, path }) =>
        method === "POST" && path === "/api/v1/applications/private-github-app",
    );
    expect(createRequest?.body).toEqual({
      project_uuid: PROJECT_UUID,
      server_uuid: SERVER_UUID,
      environment_name: ENVIRONMENT_NAME,
      github_app_uuid: GITHUB_APP_UUID,
      git_repository: "OpenDevEd/new-el",
      git_branch: "main",
      git_commit_sha: RUNTIME_COMMIT,
      build_pack: "dockercompose",
      name: createCoolifyLibraryTag(LIBRARY_ID),
      ports_exposes: "80",
      docker_compose_location: "/docker/compose.library.yaml",
      docker_compose_domains: [{ name: "web", domain: PUBLIC_DOMAIN }],
      tags: [createCoolifyLibraryTag(LIBRARY_ID)],
      is_auto_deploy_enabled: false,
      is_preview_deployments_enabled: false,
      instant_deploy: false,
      connect_to_docker_network: false,
      force_domain_override: false,
      autogenerate_domain: false,
      inject_build_args_to_dockerfile: false,
      include_source_commit_in_build: false,
    });
    for (const request of server.requests) {
      expect(request.headers.get("authorization")).toBe(
        `Bearer ${COOLIFY_TOKEN}`,
      );
      expect(request.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("repairs mutable app fields, removes stale local variables, and then matches clean state", async () => {
    const coolifyOwned = environment("SERVICE_URL_WEB", PUBLIC_DOMAIN, {
      uuid: "env-service-url-web",
      is_coolify: true,
      is_literal: false,
    });
    const server = createCoolifyServer({
      application: expectedApplication({
        name: "old-name",
        git_branch: "old-branch",
        git_commit_sha: OTHER_COMMIT,
        docker_compose_location: "/docker/old.yaml",
        docker_compose_domains: JSON.stringify({
          web: { domain: "https://old.example.test" },
          meilisearch: { domain: "https://search.example.test" },
        }),
        settings: {
          is_auto_deploy_enabled: true,
          is_preview_deployments_enabled: true,
          connect_to_docker_network: true,
          inject_build_args_to_dockerfile: true,
          include_source_commit_in_build: true,
        },
      }),
      tags: [createCoolifyLibraryTag(LIBRARY_ID)],
      environments: [
        environment("LIBRARY_CONFIG_JSON", "{}", {
          is_literal: false,
          is_runtime: false,
          is_buildtime: false,
        }),
        environment("LIBRARY_CONFIG_JSON", "preview", {
          uuid: "env-library-config-preview",
          is_preview: true,
        }),
        environment("SYNC_TARGETS", "stale"),
        coolifyOwned,
      ],
    });
    const client = createClient(server.fetchImpl);

    await expect(
      client.reconcileApplication(reconcileInput()),
    ).resolves.toMatchObject({
      outcome: "updated",
      applicationUuid: APPLICATION_UUID,
    });
    await expect(
      client.reconcileApplication(reconcileInput()),
    ).resolves.toEqual({
      outcome: "matched",
      applicationUuid: APPLICATION_UUID,
      applicationTag: createCoolifyLibraryTag(LIBRARY_ID),
      runtimeConfigSha256: createHash("sha256")
        .update(LIBRARY_CONFIG_JSON)
        .digest("hex"),
      coolifyConfigHash: server.application?.config_hash,
    });

    expect(server.application).toMatchObject(
      expectedApplication({
        config_hash: server.application?.config_hash ?? "",
      }),
    );
    expect(
      server.environments
        .filter(
          ({ is_coolify, is_buildpack_control, is_shared }) =>
            !is_coolify && !is_buildpack_control && !is_shared,
        )
        .map(
          ({
            key,
            value,
            is_preview,
            is_literal,
            is_runtime,
            is_buildtime,
          }) => ({
            key,
            value,
            is_preview,
            is_literal,
            is_runtime,
            is_buildtime,
          }),
        ),
    ).toEqual([
      {
        key: "LIBRARY_CONFIG_JSON",
        value: LIBRARY_CONFIG_JSON,
        is_preview: false,
        is_literal: true,
        is_runtime: true,
        is_buildtime: true,
      },
      {
        key: "MEILISEARCH_MASTER_KEY",
        value: MEILISEARCH_MASTER_KEY,
        is_preview: false,
        is_literal: true,
        is_runtime: true,
        is_buildtime: true,
      },
    ]);
    expect(server.environments).toContainEqual(coolifyOwned);
  });

  it("stops when one deterministic tag resolves to two applications", async () => {
    const application = expectedApplication();
    const fetchImpl: typeof fetch = vi.fn(async (requestInput) => {
      const url = new URL(String(requestInput));
      if (url.pathname === "/api/v1/github-apps") {
        return jsonResponse([{ id: GITHUB_APP_ID, uuid: GITHUB_APP_UUID }]);
      }
      if (url.pathname === "/api/v1/applications") {
        return jsonResponse([
          application,
          { ...application, uuid: "app000000000000000000002" },
        ]);
      }
      return jsonResponse({ message: "Unexpected" }, 500);
    });

    await expect(
      createClient(fetchImpl).reconcileApplication(reconcileInput()),
    ).rejects.toMatchObject({
      code: "COOLIFY_APPLICATION_CONFLICT",
      message: "More than one Coolify application uses this library tag",
    });
  });

  it("does not move an application that belongs to another Coolify project", async () => {
    const server = createCoolifyServer({
      application: expectedApplication({
        environment: {
          name: ENVIRONMENT_NAME,
          project: { uuid: "another-project" },
        },
      }),
      tags: [createCoolifyLibraryTag(LIBRARY_ID)],
    });

    await expect(
      createClient(server.fetchImpl).reconcileApplication(reconcileInput()),
    ).rejects.toMatchObject({
      code: "COOLIFY_APPLICATION_CONFLICT",
      message: "The tagged Coolify application belongs to another target",
    });
    expect(server.application?.environment.project.uuid).toBe(
      "another-project",
    );
  });

  it("fails when an application repair does not survive readback", async () => {
    const server = createCoolifyServer({
      application: expectedApplication({ git_branch: "old-branch" }),
      tags: [createCoolifyLibraryTag(LIBRARY_ID)],
      ignoreApplicationWrites: true,
    });

    await expect(
      createClient(server.fetchImpl).reconcileApplication(reconcileInput()),
    ).rejects.toMatchObject({
      code: "COOLIFY_APPLICATION_MISMATCH",
      message: "Coolify did not save the required application settings",
    });
    expect(server.application?.git_branch).toBe("old-branch");
  });

  it("fails when an environment write does not survive readback", async () => {
    const server = createCoolifyServer({
      application: expectedApplication(),
      tags: [createCoolifyLibraryTag(LIBRARY_ID)],
      ignoreEnvironmentWrites: true,
    });

    await expect(
      createClient(server.fetchImpl).reconcileApplication(reconcileInput()),
    ).rejects.toMatchObject({
      code: "COOLIFY_ENVIRONMENT_MISMATCH",
      message: "Coolify did not save the required environment variables",
    });
  });

  it("adopts a deployment only when the app, commit, and Coolify hash all match", async () => {
    const configHash = hashForRevision(1);
    const server = createCoolifyServer({
      application: expectedApplication({ config_hash: configHash }),
      tags: [createCoolifyLibraryTag(LIBRARY_ID)],
      deployments: [
        {
          application_id: "42",
          deployment_uuid: "deployment-wrong-hash",
          commit: RUNTIME_COMMIT,
          configuration_hash: hashForRevision(9),
          status: "finished",
        },
        {
          application_id: "42",
          deployment_uuid: "deployment-failed",
          commit: RUNTIME_COMMIT,
          configuration_hash: configHash,
          status: "failed",
        },
        {
          application_id: "42",
          deployment_uuid: "deployment-active",
          commit: RUNTIME_COMMIT,
          configuration_hash: configHash,
          status: "in_progress",
        },
      ],
    });
    const client = createClient(server.fetchImpl);

    await expect(
      client.startOrAdoptDeployment({
        applicationUuid: APPLICATION_UUID,
        runtimeCommit: RUNTIME_COMMIT,
        coolifyConfigHash: configHash,
      }),
    ).resolves.toEqual({
      outcome: "adopted",
      applicationUuid: APPLICATION_UUID,
      deployment: {
        applicationId: "42",
        deploymentUuid: "deployment-active",
        runtimeCommit: RUNTIME_COMMIT,
        coolifyConfigHash: configHash,
        status: "in_progress",
        state: "active",
      },
    });
    expect(server.deployments).toHaveLength(3);
  });

  it.each(["failed", "cancelled-by-user"])(
    "starts a replacement after a matching %s deployment",
    async (status) => {
      const configHash = hashForRevision(1);
      const server = createCoolifyServer({
        application: expectedApplication({ config_hash: configHash }),
        deployments: [
          {
            application_id: "42",
            deployment_uuid: `deployment-${status}`,
            commit: RUNTIME_COMMIT,
            configuration_hash: configHash,
            status,
          },
        ],
      });

      const result = await createClient(
        server.fetchImpl,
      ).startOrAdoptDeployment({
        applicationUuid: APPLICATION_UUID,
        runtimeCommit: RUNTIME_COMMIT,
        coolifyConfigHash: configHash,
      });

      expect(result).toEqual({
        outcome: "started",
        applicationUuid: APPLICATION_UUID,
        deploymentUuid: "deployment-started-2",
        runtimeCommit: RUNTIME_COMMIT,
        coolifyConfigHash: configHash,
      });
      const startRequest = server.requests.find(
        ({ method, path }) => method === "POST" && path === "/api/v1/deploy",
      );
      const query = new URLSearchParams(startRequest?.search);
      expect(query.get("uuid")).toBe(APPLICATION_UUID);
      expect(query.get("force")).toBe("false");
    },
  );

  it("returns an honest limitation when a live deployment has no configuration hash", async () => {
    const configHash = hashForRevision(1);
    const server = createCoolifyServer({
      application: expectedApplication({ config_hash: configHash }),
      deployments: [
        {
          application_id: "42",
          deployment_uuid: "deployment-without-hash",
          commit: RUNTIME_COMMIT,
          status: "queued",
        },
      ],
    });

    await expect(
      createClient(server.fetchImpl).startOrAdoptDeployment({
        applicationUuid: APPLICATION_UUID,
        runtimeCommit: RUNTIME_COMMIT,
        coolifyConfigHash: configHash,
      }),
    ).resolves.toEqual({
      outcome: "adoption-unavailable",
      applicationUuid: APPLICATION_UUID,
      reason: "configuration-hash-missing",
    });
    expect(server.deployments).toHaveLength(1);
  });

  it("does not start from a deployment history that exceeds the bounded response", async () => {
    const configHash = hashForRevision(1);
    const server = createCoolifyServer({
      application: expectedApplication({ config_hash: configHash }),
      deployments: [],
      deploymentCount: 101,
    });

    await expect(
      createClient(server.fetchImpl).startOrAdoptDeployment({
        applicationUuid: APPLICATION_UUID,
        runtimeCommit: RUNTIME_COMMIT,
        coolifyConfigHash: configHash,
      }),
    ).resolves.toEqual({
      outcome: "adoption-unavailable",
      applicationUuid: APPLICATION_UUID,
      reason: "deployment-history-truncated",
    });
    expect(server.deployments).toHaveLength(0);
  });

  it.each([
    ["queued", "active"],
    ["in_progress", "active"],
    ["finished", "finished"],
    ["failed", "failed"],
    ["cancelled-by-user", "cancelled"],
  ] as const)("parses %s as %s without polling", async (status, state) => {
    const configHash = hashForRevision(1);
    const deploymentUuid = `deployment-${status}`;
    const server = createCoolifyServer({
      application: expectedApplication({ config_hash: configHash }),
      deployments: [
        {
          application_id: "42",
          deployment_uuid: deploymentUuid,
          commit: RUNTIME_COMMIT,
          configuration_hash: configHash,
          status,
        },
      ],
    });

    await expect(
      createClient(server.fetchImpl).readDeployment(deploymentUuid),
    ).resolves.toEqual({
      applicationId: "42",
      deploymentUuid,
      runtimeCommit: RUNTIME_COMMIT,
      coolifyConfigHash: configHash,
      status,
      state,
    });
  });

  it("requires a finished deployment that belongs to the saved application", async () => {
    const configHash = hashForRevision(1);
    const server = createCoolifyServer({
      application: expectedApplication({ id: 42, config_hash: configHash }),
      deployments: [
        {
          application_id: "42",
          deployment_uuid: "deployment-finished",
          commit: RUNTIME_COMMIT,
          configuration_hash: configHash,
          status: "finished",
        },
      ],
    });

    await expect(
      createClient(server.fetchImpl).requireFinishedDeployment({
        applicationUuid: APPLICATION_UUID,
        deploymentUuid: "deployment-finished",
        runtimeCommit: RUNTIME_COMMIT,
        coolifyConfigHash: configHash,
      }),
    ).resolves.toEqual({
      applicationId: "42",
      deploymentUuid: "deployment-finished",
      runtimeCommit: RUNTIME_COMMIT,
      coolifyConfigHash: configHash,
      status: "finished",
      state: "finished",
    });
  });

  it("rejects a finished deployment that belongs to another application", async () => {
    const configHash = hashForRevision(1);
    const server = createCoolifyServer({
      application: expectedApplication({ id: 42, config_hash: configHash }),
      deployments: [
        {
          application_id: "43",
          deployment_uuid: "deployment-other-application",
          commit: RUNTIME_COMMIT,
          configuration_hash: configHash,
          status: "finished",
        },
      ],
    });

    await expect(
      createClient(server.fetchImpl).requireFinishedDeployment({
        applicationUuid: APPLICATION_UUID,
        deploymentUuid: "deployment-other-application",
        runtimeCommit: RUNTIME_COMMIT,
        coolifyConfigHash: configHash,
      }),
    ).rejects.toMatchObject({
      code: "COOLIFY_DEPLOYMENT_CONFLICT",
      message: "The Coolify deployment belongs to another application",
    });
  });

  it("rejects an unknown deployment status instead of treating it as active", async () => {
    const server = createCoolifyServer({
      application: expectedApplication(),
      deployments: [
        {
          application_id: "42",
          deployment_uuid: "deployment-unknown",
          commit: RUNTIME_COMMIT,
          configuration_hash: hashForRevision(1),
          status: "waiting-somehow",
        },
      ],
    });

    await expect(
      createClient(server.fetchImpl).readDeployment("deployment-unknown"),
    ).rejects.toMatchObject({
      code: "COOLIFY_INVALID_RESPONSE",
      message: "Coolify returned an invalid deployment response",
    });
  });

  it.each([
    "http://coolify.example.test",
    "https://coolify.example.test/api/v1",
    "https://coolify.example.test?team=other",
    "https://user:password@coolify.example.test",
  ])("rejects the non-origin Coolify URL %s before fetching", (origin) => {
    const fetchImpl = vi.fn<typeof fetch>();

    expect(() =>
      createCoolifyClient({ origin, token: COOLIFY_TOKEN, fetchImpl }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_COOLIFY_CONFIG",
        message: "Coolify URL must be a valid HTTPS origin",
      }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("times out a hanging request and hides the token and remote error", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchImpl: typeof fetch = vi.fn(
      async (_requestInput: RequestInfo | URL, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("Missing signal"));
            return;
          }
          signals.push(signal);
          signal.addEventListener(
            "abort",
            () => reject(new Error(`remote timeout using ${COOLIFY_TOKEN}`)),
            { once: true },
          );
        }),
    );

    const errorPromise = createClient(fetchImpl)
      .reconcileApplication(reconcileInput())
      .catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await errorPromise;

    expect(error).toBeInstanceOf(CoolifyClientError);
    expect(error).toMatchObject({
      code: "COOLIFY_UNAVAILABLE",
      message: "Coolify could not be reached",
    });
    expect(String(error)).not.toContain(COOLIFY_TOKEN);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("does not copy a rejected response body or environment value into errors", async () => {
    const remoteSecret = `remote failure ${LIBRARY_CONFIG_JSON}`;
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ message: remoteSecret, token: COOLIFY_TOKEN }, 503),
    );

    const error = await createClient(fetchImpl)
      .reconcileApplication(reconcileInput())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CoolifyClientError);
    expect(error).toMatchObject({
      code: "COOLIFY_REQUEST_FAILED",
      message: "Coolify rejected the request",
    });
    expect(String(error)).not.toContain(remoteSecret);
    expect(String(error)).not.toContain(COOLIFY_TOKEN);
    expect(String(error)).not.toContain(LIBRARY_CONFIG_JSON);
  });

  it("rejects an oversized successful response before parsing it", async () => {
    const fetchImpl: typeof fetch = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: {
            "content-length": String(3 * 1024 * 1024),
            "content-type": "application/json",
          },
        }),
    );

    await expect(
      createClient(fetchImpl).reconcileApplication(reconcileInput()),
    ).rejects.toMatchObject({
      code: "COOLIFY_INVALID_RESPONSE",
      message: "Coolify returned too much data",
    });
  });
});
