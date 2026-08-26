"use node";

import { createHash } from "node:crypto";
import type { Id } from "../_generated/dataModel";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_APPLICATION_MATCHES = 2;
const MAX_GITHUB_APPS = 100;
const MAX_ENVIRONMENT_VARIABLES = 256;
const MAX_DEPLOYMENTS = 100;
const ENVIRONMENT_READBACK_DELAYS_MS = [100, 250, 500, 1_000] as const;
const UUID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const COOLIFY_CONFIG_HASH = /^(?:[a-f0-9]{32}|[a-f0-9]{64})$/u;
const LIBRARY_ID = /^[A-Za-z0-9]{1,64}$/u;

const GIT_REPOSITORY = "OpenDevEd/new-el";
const GIT_BRANCH = "main";
const BUILD_PACK = "dockercompose";
const COMPOSE_PATH = "/docker/compose.library.yaml";
const PORTS_EXPOSES = "80";
const GITHUB_SOURCE_TYPE = "App\\Models\\GithubApp";

const APPLICATION_SETTING_KEYS = [
  "is_auto_deploy_enabled",
  "is_preview_deployments_enabled",
  "connect_to_docker_network",
  "inject_build_args_to_dockerfile",
  "include_source_commit_in_build",
  "is_container_label_escape_enabled",
] as const;

const ENVIRONMENT_VALUES = [
  "LIBRARY_CONFIG_JSON",
  "MEILISEARCH_MASTER_KEY",
  "SOURCE_COMMIT",
] as const;

export type CoolifyReconcileOutcome = "created" | "matched" | "updated";

export type CoolifyApplicationResult = {
  outcome: CoolifyReconcileOutcome;
  applicationUuid: string;
  applicationTag: string;
  runtimeConfigSha256: string;
  coolifyConfigHash: string;
};

export type CoolifyConfigurationUpdateResult = {
  applicationUuid: string;
  runtimeCommit: string;
  runtimeConfigSha256: string;
  coolifyConfigHash: string;
};

export type CoolifyBoundApplication = {
  applicationUuid: string;
  runtimeCommit: string;
  coolifyConfigHash: string;
};

export type CoolifyDeploymentStatus =
  | "queued"
  | "in_progress"
  | "finished"
  | "failed"
  | "cancelled-by-user";

export type CoolifyDeploymentState =
  | "active"
  | "finished"
  | "failed"
  | "cancelled";

export type CoolifyDeployment = {
  deploymentUuid: string;
  runtimeCommit: string;
  coolifyConfigHash: string | null;
  createdAt?: number;
  status: CoolifyDeploymentStatus;
  state: CoolifyDeploymentState;
};

export type CoolifyDeploymentSelection =
  | {
      outcome: "adopted";
      applicationUuid: string;
      deployment: CoolifyDeployment;
    }
  | {
      outcome: "started";
      applicationUuid: string;
      deploymentUuid: string;
      runtimeCommit: string;
      coolifyConfigHash: string;
    }
  | {
      outcome: "adoption-unavailable";
      applicationUuid: string;
      reason: "configuration-hash-missing";
    };

export type CoolifyDeploymentList = {
  complete: boolean;
  deployments: CoolifyDeployment[];
};

export class CoolifyClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CoolifyClientError";
  }
}

export function requireMatchingCoolifyDeployment(
  deployment: CoolifyDeployment,
  expected: { runtimeCommit: string },
): void {
  if (deployment.runtimeCommit !== expected.runtimeCommit) {
    throw new CoolifyClientError(
      "COOLIFY_DEPLOYMENT_CONFLICT",
      "Coolify deployed another Evidence Library release",
    );
  }
}

type CoolifyRequest = {
  allowNotFound?: boolean;
  body?: Record<string, unknown>;
  expectedStatus: number;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
};

type CoolifyTransport = {
  fetchImpl: typeof fetch;
  origin: URL;
  token: string;
};

type ComposeDomain = {
  domain: string;
  redirect?: "www" | "non-www" | "both";
};

type ApplicationSettings = Record<
  (typeof APPLICATION_SETTING_KEYS)[number],
  boolean
>;

type CoolifyApplication = {
  uuid: string;
  name: string;
  configHash: string;
  gitRepository: string;
  gitBranch: string;
  gitCommitSha: string;
  buildPack: string;
  portsExposes: string;
  fqdn: string | null;
  composePath: string;
  composeDomains: Record<string, ComposeDomain> | null;
  sourceType: string | null;
  sourceId: number | null;
  environmentName: string;
  projectUuid: string;
  serverUuid: string;
  settings: ApplicationSettings;
};

type DesiredApplication = {
  applicationTag: string;
  serverUuid: string;
  projectUuid: string;
  environmentName: string;
  githubAppUuid: string;
  githubAppId: number;
  runtimeCommit: string;
  publicDomain: string;
};

type CoolifyEnvironment = {
  uuid: string;
  key: string;
  value: string;
  isPreview: boolean;
  isLiteral: boolean;
  isMultiline: boolean;
  isShownOnce: boolean;
  isRuntime: boolean;
  isBuildtime: boolean;
  isCoolify: boolean;
  isBuildpackControl: boolean;
  isShared: boolean;
  comment: string | null;
};

type DesiredEnvironment = {
  key: (typeof ENVIRONMENT_VALUES)[number];
  value: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(message: string): never {
  throw new CoolifyClientError("COOLIFY_INVALID_RESPONSE", message);
}

function requireOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      "Coolify URL must be an HTTPS origin or the private Coolify service",
    );
  }
  const isPrivateCoolifyService = url.origin === "http://coolify:8080";
  if (
    (url.protocol !== "https:" && !isPrivateCoolifyService) ||
    url.origin === "null" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      "Coolify URL must be an HTTPS origin or the private Coolify service",
    );
  }
  return new URL(url.origin);
}

function requireToken(value: string): string {
  const token = value.trim();
  if (!token || /[\u0000-\u001f\u007f]/u.test(token)) {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      "Coolify token is missing or invalid",
    );
  }
  return token;
}

function requireInputIdentifier(label: string, value: string): string {
  const identifier = value.trim();
  if (!UUID.test(identifier)) {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      `${label} is missing or invalid`,
    );
  }
  return identifier;
}

function requireInputText(label: string, value: string): string {
  const text = value.trim();
  if (!text || text.length > 255 || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      `${label} is missing or invalid`,
    );
  }
  return text;
}

function requireCommit(value: string): string {
  if (!COMMIT.test(value)) {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      "Evidence Library commit must be a lowercase 40-character commit",
    );
  }
  return value;
}

function requireConfigHash(value: string): string {
  if (!COOLIFY_CONFIG_HASH.test(value)) {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      "Coolify configuration hash must be a lowercase MD5 or SHA-256 value",
    );
  }
  return value;
}

function requireAdoptionBoundary(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      "Deployment adoption boundary is invalid",
    );
  }
  return Math.floor(value / 1_000) * 1_000;
}

function requirePublicDomain(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      "Evidence Library domain must be a valid HTTPS origin",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.origin === "null" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      "Evidence Library domain must be a valid HTTPS origin",
    );
  }
  return url.origin;
}

function requireLibraryConfigJson(value: string): string {
  if (!value || new TextEncoder().encode(value).byteLength > 900_000) {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      "Evidence Library runtime configuration is missing or too large",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      "Evidence Library runtime configuration must be valid JSON",
    );
  }
  if (!isRecord(parsed)) {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      "Evidence Library runtime configuration must be a JSON object",
    );
  }
  return value;
}

function requireSecret(label: string, value: string): string {
  if (!value.trim()) {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      `${label} is missing`,
    );
  }
  return value;
}

function responseString(
  record: Record<string, unknown>,
  key: string,
  message: string,
): string {
  const value = record[key];
  if (typeof value !== "string") invalidResponse(message);
  return value;
}

function responseUuid(
  record: Record<string, unknown>,
  key: string,
  message: string,
): string {
  const value = responseString(record, key, message);
  if (!UUID.test(value)) invalidResponse(message);
  return value;
}

function responseBoolean(
  record: Record<string, unknown>,
  key: string,
  message: string,
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") invalidResponse(message);
  return value;
}

function responseNullableString(
  record: Record<string, unknown>,
  key: string,
  message: string,
): string | null {
  const value = record[key];
  if (value !== null && typeof value !== "string") invalidResponse(message);
  return value;
}

async function requestCoolify(
  client: CoolifyTransport,
  request: CoolifyRequest,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await client.fetchImpl(new URL(request.path, client.origin), {
        method: request.method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${client.token}`,
          ...(request.body ? { "content-type": "application/json" } : {}),
        },
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw new CoolifyClientError(
        "COOLIFY_UNAVAILABLE",
        "Coolify could not be reached",
      );
    }
    if (response.status !== request.expectedStatus) {
      if (request.allowNotFound && response.status === 404) return null;
      throw new CoolifyClientError(
        "COOLIFY_REQUEST_FAILED",
        "Coolify rejected the request",
      );
    }
    try {
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_BYTES
      ) {
        invalidResponse("Coolify returned too much data");
      }
      const reader = response.body?.getReader();
      if (!reader) invalidResponse("Coolify returned invalid JSON");
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          invalidResponse("Coolify returned too much data");
        }
        chunks.push(value);
      }
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch (error) {
      if (error instanceof CoolifyClientError) throw error;
      throw new CoolifyClientError(
        "COOLIFY_INVALID_RESPONSE",
        "Coolify returned invalid JSON",
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function createCoolifyLibraryTag(
  libraryId: Id<"evidenceLibraries">,
): string {
  if (!LIBRARY_ID.test(libraryId)) {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      "Evidence Library ID is missing or invalid",
    );
  }
  return `openscholar-library-${libraryId}`;
}

function parseUuidResponse(payload: unknown, expectedUuid: string): void {
  if (!isRecord(payload) || payload.uuid !== expectedUuid) {
    invalidResponse("Coolify returned an invalid application response");
  }
}

function parseComposeDomains(
  payload: unknown,
): Record<string, ComposeDomain> | null {
  if (payload === null) return null;
  if (typeof payload !== "string") {
    invalidResponse("Coolify returned an invalid application response");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    invalidResponse("Coolify returned an invalid application response");
  }
  if (!isRecord(parsed) || Object.keys(parsed).length > 32) {
    invalidResponse("Coolify returned an invalid application response");
  }
  const domains: Record<string, ComposeDomain> = {};
  for (const [service, value] of Object.entries(parsed)) {
    if (!service || !isRecord(value) || typeof value.domain !== "string") {
      invalidResponse("Coolify returned an invalid application response");
    }
    const redirect = value.redirect;
    if (
      redirect !== undefined &&
      redirect !== null &&
      redirect !== "www" &&
      redirect !== "non-www" &&
      redirect !== "both"
    ) {
      invalidResponse("Coolify returned an invalid application response");
    }
    domains[service] = {
      domain: value.domain,
      ...(redirect === undefined || redirect === null ? {} : { redirect }),
    };
  }
  return domains;
}

function parseApplication(payload: unknown): CoolifyApplication {
  const message = "Coolify returned an invalid application response";
  if (!isRecord(payload)) invalidResponse(message);
  const settingsPayload = payload.settings;
  const environmentPayload = payload.environment;
  const destinationPayload = payload.destination;
  if (
    !isRecord(settingsPayload) ||
    !isRecord(environmentPayload) ||
    !isRecord(environmentPayload.project) ||
    !isRecord(destinationPayload) ||
    !isRecord(destinationPayload.server)
  ) {
    invalidResponse(message);
  }
  const configHash = responseString(payload, "config_hash", message);
  if (!COOLIFY_CONFIG_HASH.test(configHash)) invalidResponse(message);
  const sourceId = payload.source_id;
  if (
    sourceId !== null &&
    (typeof sourceId !== "number" ||
      !Number.isSafeInteger(sourceId) ||
      sourceId < 0)
  ) {
    invalidResponse(message);
  }
  const sourceType = responseNullableString(payload, "source_type", message);
  const settings = Object.fromEntries(
    APPLICATION_SETTING_KEYS.map((key) => [
      key,
      responseBoolean(settingsPayload, key, message),
    ]),
  ) as ApplicationSettings;

  return {
    uuid: responseUuid(payload, "uuid", message),
    name: responseString(payload, "name", message),
    configHash,
    gitRepository: responseString(payload, "git_repository", message),
    gitBranch: responseString(payload, "git_branch", message),
    gitCommitSha: responseString(payload, "git_commit_sha", message),
    buildPack: responseString(payload, "build_pack", message),
    portsExposes: responseString(payload, "ports_exposes", message),
    fqdn: responseNullableString(payload, "fqdn", message),
    composePath: responseString(payload, "docker_compose_location", message),
    composeDomains: parseComposeDomains(payload.docker_compose_domains),
    sourceType,
    sourceId,
    environmentName: responseString(environmentPayload, "name", message),
    projectUuid: responseUuid(environmentPayload.project, "uuid", message),
    serverUuid: responseUuid(destinationPayload.server, "uuid", message),
    settings,
  };
}

async function readApplication(
  client: CoolifyTransport,
  applicationUuid: string,
): Promise<CoolifyApplication> {
  return parseApplication(
    await requestCoolify(client, {
      expectedStatus: 200,
      method: "GET",
      path: `/api/v1/applications/${encodeURIComponent(applicationUuid)}`,
    }),
  );
}

async function readApplicationIfExists(
  client: CoolifyTransport,
  applicationUuid: string,
): Promise<CoolifyApplication | null> {
  const payload = await requestCoolify(client, {
    allowNotFound: true,
    expectedStatus: 200,
    method: "GET",
    path: `/api/v1/applications/${encodeURIComponent(applicationUuid)}`,
  });
  return payload === null ? null : parseApplication(payload);
}

async function readGithubAppId(
  client: CoolifyTransport,
  githubAppUuid: string,
): Promise<number> {
  const payload = await requestCoolify(client, {
    expectedStatus: 200,
    method: "GET",
    path: "/api/v1/github-apps",
  });
  if (!Array.isArray(payload) || payload.length > MAX_GITHUB_APPS) {
    invalidResponse("Coolify returned an invalid GitHub App response");
  }
  const matches: number[] = [];
  for (const item of payload) {
    if (!isRecord(item)) {
      invalidResponse("Coolify returned an invalid GitHub App response");
    }
    const uuid = responseUuid(
      item,
      "uuid",
      "Coolify returned an invalid GitHub App response",
    );
    const id = item.id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) {
      invalidResponse("Coolify returned an invalid GitHub App response");
    }
    if (uuid === githubAppUuid) matches.push(id);
  }
  if (matches.length !== 1) {
    throw new CoolifyClientError(
      "COOLIFY_APPLICATION_CONFLICT",
      "The configured Coolify GitHub App was not found exactly once",
    );
  }
  return matches[0]!;
}

async function listTaggedApplications(
  client: CoolifyTransport,
  applicationTag: string,
): Promise<string[]> {
  const url = new URL("/api/v1/applications", client.origin);
  url.searchParams.set("tag", applicationTag);
  const payload = await requestCoolify(client, {
    expectedStatus: 200,
    method: "GET",
    path: `${url.pathname}${url.search}`,
  });
  if (!Array.isArray(payload) || payload.length > MAX_APPLICATION_MATCHES) {
    if (Array.isArray(payload) && payload.length > 1) {
      throw new CoolifyClientError(
        "COOLIFY_APPLICATION_CONFLICT",
        "More than one Coolify application uses this library tag",
      );
    }
    invalidResponse("Coolify returned an invalid application list");
  }
  const uuids = payload.map((item) => {
    if (!isRecord(item)) {
      invalidResponse("Coolify returned an invalid application list");
    }
    return responseUuid(
      item,
      "uuid",
      "Coolify returned an invalid application list",
    );
  });
  if (new Set(uuids).size !== uuids.length) {
    invalidResponse("Coolify returned an invalid application list");
  }
  if (uuids.length > 1) {
    throw new CoolifyClientError(
      "COOLIFY_APPLICATION_CONFLICT",
      "More than one Coolify application uses this library tag",
    );
  }
  return uuids;
}

function parseTags(payload: unknown): string[] {
  if (!Array.isArray(payload) || payload.length > 100) {
    invalidResponse("Coolify returned an invalid application tag response");
  }
  return payload.map((item) => {
    if (!isRecord(item)) {
      invalidResponse("Coolify returned an invalid application tag response");
    }
    responseUuid(
      item,
      "uuid",
      "Coolify returned an invalid application tag response",
    );
    return responseString(
      item,
      "name",
      "Coolify returned an invalid application tag response",
    );
  });
}

async function readTags(
  client: CoolifyTransport,
  applicationUuid: string,
): Promise<string[]> {
  return parseTags(
    await requestCoolify(client, {
      expectedStatus: 200,
      method: "GET",
      path: `/api/v1/applications/${encodeURIComponent(applicationUuid)}/tags`,
    }),
  );
}

function hasExpectedComposeDomain(
  domains: Record<string, ComposeDomain> | null,
  publicDomain: string,
): boolean {
  return (
    domains !== null &&
    Object.keys(domains).length === 1 &&
    domains.web?.domain === publicDomain
  );
}

function hasExpectedTarget(
  application: CoolifyApplication,
  desired: DesiredApplication,
): boolean {
  return (
    application.sourceType === GITHUB_SOURCE_TYPE &&
    application.sourceId === desired.githubAppId &&
    application.environmentName === desired.environmentName &&
    application.projectUuid === desired.projectUuid &&
    application.serverUuid === desired.serverUuid
  );
}

function hasExpectedApplication(
  application: CoolifyApplication,
  desired: DesiredApplication,
): boolean {
  return (
    hasExpectedTarget(application, desired) &&
    application.name === desired.applicationTag &&
    application.gitRepository === GIT_REPOSITORY &&
    application.gitBranch === GIT_BRANCH &&
    application.gitCommitSha === desired.runtimeCommit &&
    application.buildPack === BUILD_PACK &&
    application.portsExposes === PORTS_EXPOSES &&
    (application.fqdn === null || application.fqdn === "") &&
    application.composePath === COMPOSE_PATH &&
    hasExpectedComposeDomain(
      application.composeDomains,
      desired.publicDomain,
    ) &&
    APPLICATION_SETTING_KEYS.every((key) => application.settings[key] === false)
  );
}

function hasExpectedBoundApplication(
  application: CoolifyApplication,
  applicationTag: string,
  publicDomain: string,
): boolean {
  return (
    application.name === applicationTag &&
    application.gitRepository === GIT_REPOSITORY &&
    application.gitBranch === GIT_BRANCH &&
    COMMIT.test(application.gitCommitSha) &&
    application.buildPack === BUILD_PACK &&
    application.portsExposes === PORTS_EXPOSES &&
    (application.fqdn === null || application.fqdn === "") &&
    application.composePath === COMPOSE_PATH &&
    hasExpectedComposeDomain(application.composeDomains, publicDomain) &&
    application.sourceType === GITHUB_SOURCE_TYPE &&
    application.sourceId !== null &&
    APPLICATION_SETTING_KEYS.every((key) => application.settings[key] === false)
  );
}

async function readExpectedBoundApplication(
  client: CoolifyTransport,
  input: {
    applicationUuid: string;
    applicationTag: string;
    publicDomain: string;
  },
): Promise<CoolifyApplication> {
  const [application, tags] = await Promise.all([
    readApplication(client, input.applicationUuid),
    readTags(client, input.applicationUuid),
  ]);
  if (
    application.uuid !== input.applicationUuid ||
    !tags.includes(input.applicationTag) ||
    !hasExpectedBoundApplication(
      application,
      input.applicationTag,
      input.publicDomain,
    )
  ) {
    throw new CoolifyClientError(
      "COOLIFY_APPLICATION_CONFLICT",
      "The bound Coolify application no longer matches this library",
    );
  }
  return application;
}

function applicationPatch(
  application: CoolifyApplication,
  desired: DesiredApplication,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (application.name !== desired.applicationTag) {
    patch.name = desired.applicationTag;
  }
  if (application.gitRepository !== GIT_REPOSITORY) {
    patch.git_repository = GIT_REPOSITORY;
  }
  if (application.gitBranch !== GIT_BRANCH) patch.git_branch = GIT_BRANCH;
  if (application.gitCommitSha !== desired.runtimeCommit) {
    patch.git_commit_sha = desired.runtimeCommit;
  }
  if (application.buildPack !== BUILD_PACK) patch.build_pack = BUILD_PACK;
  if (application.portsExposes !== PORTS_EXPOSES) {
    patch.ports_exposes = PORTS_EXPOSES;
  }
  if (application.composePath !== COMPOSE_PATH) {
    patch.docker_compose_location = COMPOSE_PATH;
  }
  if (
    !hasExpectedComposeDomain(application.composeDomains, desired.publicDomain)
  ) {
    patch.docker_compose_domains = [
      { name: "web", domain: desired.publicDomain },
    ];
    patch.force_domain_override = false;
  }
  for (const key of APPLICATION_SETTING_KEYS) {
    if (application.settings[key] !== false) patch[key] = false;
  }
  if (Object.keys(patch).length === 0) return null;
  patch.instant_deploy = false;
  return patch;
}

async function createApplication(
  client: CoolifyTransport,
  desired: DesiredApplication,
): Promise<string> {
  const payload = await requestCoolify(client, {
    expectedStatus: 201,
    method: "POST",
    path: "/api/v1/applications/private-github-app",
    body: {
      project_uuid: desired.projectUuid,
      server_uuid: desired.serverUuid,
      environment_name: desired.environmentName,
      github_app_uuid: desired.githubAppUuid,
      git_repository: GIT_REPOSITORY,
      git_branch: GIT_BRANCH,
      git_commit_sha: desired.runtimeCommit,
      build_pack: BUILD_PACK,
      name: desired.applicationTag,
      ports_exposes: PORTS_EXPOSES,
      docker_compose_location: COMPOSE_PATH,
      docker_compose_domains: [{ name: "web", domain: desired.publicDomain }],
      tags: [desired.applicationTag],
      is_auto_deploy_enabled: false,
      is_preview_deployments_enabled: false,
      instant_deploy: false,
      connect_to_docker_network: false,
      force_domain_override: false,
      autogenerate_domain: false,
      inject_build_args_to_dockerfile: false,
      include_source_commit_in_build: false,
      is_container_label_escape_enabled: false,
    },
  });
  if (!isRecord(payload)) {
    invalidResponse("Coolify returned an invalid application response");
  }
  return responseUuid(
    payload,
    "uuid",
    "Coolify returned an invalid application response",
  );
}

async function reconcileApplicationFields(
  client: CoolifyTransport,
  applicationUuid: string,
  desired: DesiredApplication,
): Promise<{ application: CoolifyApplication; changed: boolean }> {
  let application = await readApplication(client, applicationUuid);
  if (
    application.uuid !== applicationUuid ||
    !hasExpectedTarget(application, desired)
  ) {
    throw new CoolifyClientError(
      "COOLIFY_APPLICATION_CONFLICT",
      "The tagged Coolify application belongs to another target",
    );
  }
  if (application.fqdn !== null && application.fqdn !== "") {
    throw new CoolifyClientError(
      "COOLIFY_APPLICATION_CONFLICT",
      "The tagged Coolify Compose application has an unsupported top-level domain",
    );
  }
  const patch = applicationPatch(application, desired);
  if (!patch) return { application, changed: false };
  const payload = await requestCoolify(client, {
    expectedStatus: 200,
    method: "PATCH",
    path: `/api/v1/applications/${encodeURIComponent(applicationUuid)}`,
    body: patch,
  });
  parseUuidResponse(payload, applicationUuid);
  application = await readApplication(client, applicationUuid);
  if (!hasExpectedApplication(application, desired)) {
    throw new CoolifyClientError(
      "COOLIFY_APPLICATION_MISMATCH",
      "Coolify did not save the required application settings",
    );
  }
  return { application, changed: true };
}

async function reconcileTag(
  client: CoolifyTransport,
  applicationUuid: string,
  applicationTag: string,
): Promise<boolean> {
  let tags = await readTags(client, applicationUuid);
  if (tags.includes(applicationTag)) return false;
  parseTags(
    await requestCoolify(client, {
      expectedStatus: 201,
      method: "POST",
      path: `/api/v1/applications/${encodeURIComponent(applicationUuid)}/tags`,
      body: { tag_name: applicationTag },
    }),
  );
  tags = await readTags(client, applicationUuid);
  if (!tags.includes(applicationTag)) {
    throw new CoolifyClientError(
      "COOLIFY_APPLICATION_MISMATCH",
      "Coolify did not save the library application tag",
    );
  }
  return true;
}

function parseEnvironmentList(payload: unknown): CoolifyEnvironment[] {
  const message = "Coolify returned an invalid environment response";
  if (!Array.isArray(payload) || payload.length > MAX_ENVIRONMENT_VARIABLES) {
    invalidResponse(message);
  }
  return payload.map((item) => {
    if (!isRecord(item)) invalidResponse(message);
    const comment = item.comment;
    if (comment !== null && typeof comment !== "string") {
      invalidResponse(message);
    }
    return {
      uuid: responseUuid(item, "uuid", message),
      key: responseString(item, "key", message),
      value: responseString(item, "value", message),
      isPreview: responseBoolean(item, "is_preview", message),
      isLiteral: responseBoolean(item, "is_literal", message),
      isMultiline: responseBoolean(item, "is_multiline", message),
      isShownOnce: responseBoolean(item, "is_shown_once", message),
      isRuntime: responseBoolean(item, "is_runtime", message),
      isBuildtime: responseBoolean(item, "is_buildtime", message),
      isCoolify: responseBoolean(item, "is_coolify", message),
      isBuildpackControl: responseBoolean(
        item,
        "is_buildpack_control",
        message,
      ),
      isShared: responseBoolean(item, "is_shared", message),
      comment,
    };
  });
}

async function readEnvironments(
  client: CoolifyTransport,
  applicationUuid: string,
): Promise<CoolifyEnvironment[]> {
  return parseEnvironmentList(
    await requestCoolify(client, {
      expectedStatus: 200,
      method: "GET",
      path: `/api/v1/applications/${encodeURIComponent(applicationUuid)}/envs`,
    }),
  );
}

async function readEnvironmentsUntil(
  client: CoolifyTransport,
  applicationUuid: string,
  predicate: (environments: CoolifyEnvironment[]) => boolean,
): Promise<CoolifyEnvironment[] | null> {
  for (let attempt = 0; ; attempt += 1) {
    const environments = await readEnvironments(client, applicationUuid);
    if (predicate(environments)) return environments;
    const delay = ENVIRONMENT_READBACK_DELAYS_MS[attempt];
    if (delay === undefined) return null;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function environmentBody(desired: DesiredEnvironment): Record<string, unknown> {
  return {
    key: desired.key,
    value: desired.value,
    is_preview: false,
    is_literal: true,
    is_multiline: false,
    is_shown_once: false,
    is_runtime: true,
    is_buildtime: true,
    comment: null,
  };
}

function hasExpectedEnvironment(
  environment: CoolifyEnvironment,
  desired: DesiredEnvironment,
): boolean {
  return (
    environment.key === desired.key &&
    environment.value === desired.value &&
    environment.isPreview === false &&
    environment.isLiteral === true &&
    environment.isMultiline === false &&
    environment.isShownOnce === false &&
    environment.isRuntime === true &&
    environment.isBuildtime === true &&
    environment.isCoolify === false &&
    environment.isBuildpackControl === false &&
    environment.isShared === false &&
    environment.comment === null
  );
}

function isPlatformEnvironment(environment: CoolifyEnvironment): boolean {
  return environment.isCoolify || environment.isBuildpackControl;
}

function isDesiredEnvironmentKey(
  key: string,
): key is (typeof ENVIRONMENT_VALUES)[number] {
  return ENVIRONMENT_VALUES.includes(
    key as (typeof ENVIRONMENT_VALUES)[number],
  );
}

async function requireEnvironmentReadback(
  client: CoolifyTransport,
  applicationUuid: string,
  desired: DesiredEnvironment,
): Promise<CoolifyEnvironment[]> {
  const environments = await readEnvironmentsUntil(
    client,
    applicationUuid,
    (current) => {
      const matches = current.filter(
        (environment) =>
          !isPlatformEnvironment(environment) &&
          !environment.isShared &&
          environment.key === desired.key &&
          environment.isPreview === false,
      );
      return (
        matches.length === 1 && hasExpectedEnvironment(matches[0]!, desired)
      );
    },
  );
  if (!environments) {
    throw new CoolifyClientError(
      "COOLIFY_ENVIRONMENT_MISMATCH",
      "Coolify did not save the required environment variables",
    );
  }
  return environments;
}

async function requireEnvironmentRemoved(
  client: CoolifyTransport,
  applicationUuid: string,
  environmentUuid: string,
): Promise<CoolifyEnvironment[]> {
  const environments = await readEnvironmentsUntil(
    client,
    applicationUuid,
    (current) => !current.some(({ uuid }) => uuid === environmentUuid),
  );
  if (!environments) {
    throw new CoolifyClientError(
      "COOLIFY_ENVIRONMENT_MISMATCH",
      "Coolify did not remove an unsupported environment variable",
    );
  }
  return environments;
}

async function reconcileEnvironmentValue(
  client: CoolifyTransport,
  applicationUuid: string,
  desired: DesiredEnvironment,
): Promise<boolean> {
  const environments = await readEnvironments(client, applicationUuid);
  if (
    environments.some(
      (environment) => environment.isShared && environment.key === desired.key,
    )
  ) {
    throw new CoolifyClientError(
      "COOLIFY_ENVIRONMENT_CONFLICT",
      "The Coolify application inherits the managed environment variable",
    );
  }
  const matches = environments.filter(
    (environment) =>
      !isPlatformEnvironment(environment) &&
      !environment.isShared &&
      environment.key === desired.key &&
      environment.isPreview === false,
  );
  if (matches.length > 1) {
    throw new CoolifyClientError(
      "COOLIFY_ENVIRONMENT_CONFLICT",
      "Coolify returned duplicate production environment variables",
    );
  }
  if (matches.length === 1 && hasExpectedEnvironment(matches[0]!, desired)) {
    return false;
  }
  const payload = await requestCoolify(client, {
    expectedStatus: 201,
    method: matches.length === 0 ? "POST" : "PATCH",
    path: `/api/v1/applications/${encodeURIComponent(applicationUuid)}/envs`,
    body: environmentBody(desired),
  });
  if (!isRecord(payload)) {
    invalidResponse("Coolify returned an invalid environment response");
  }
  responseUuid(
    payload,
    "uuid",
    "Coolify returned an invalid environment response",
  );
  await requireEnvironmentReadback(client, applicationUuid, desired);
  return true;
}

async function reconcileEnvironments(
  client: CoolifyTransport,
  applicationUuid: string,
  desiredValues: DesiredEnvironment[],
): Promise<boolean> {
  let changed = false;
  const removeUnsupportedEnvironments = async (): Promise<void> => {
    const environments = await readEnvironments(client, applicationUuid);
    for (const environment of environments) {
      if (isPlatformEnvironment(environment)) continue;
      if (environment.isShared) {
        throw new CoolifyClientError(
          "COOLIFY_ENVIRONMENT_CONFLICT",
          "The Coolify application inherits an unsupported shared variable",
        );
      }
      if (isDesiredEnvironmentKey(environment.key) && !environment.isPreview) {
        continue;
      }
      await requestCoolify(client, {
        expectedStatus: 200,
        method: "DELETE",
        path: `/api/v1/applications/${encodeURIComponent(applicationUuid)}/envs/${encodeURIComponent(environment.uuid)}`,
      });
      await requireEnvironmentRemoved(
        client,
        applicationUuid,
        environment.uuid,
      );
      changed = true;
    }
  };

  await removeUnsupportedEnvironments();

  for (const desired of desiredValues) {
    changed =
      (await reconcileEnvironmentValue(client, applicationUuid, desired)) ||
      changed;
  }

  // Coolify can create a preview twin when a production value is first added.
  // Remove it after writes so the application has one managed value per key.
  await removeUnsupportedEnvironments();

  const hasExactEnvironmentSet = (
    environments: CoolifyEnvironment[],
  ): boolean => {
    const localEnvironments = environments.filter(
      (environment) =>
        !isPlatformEnvironment(environment) && !environment.isShared,
    );
    return (
      localEnvironments.length === desiredValues.length &&
      desiredValues.every((desired) => {
        const matches = localEnvironments.filter(
          (environment) =>
            environment.key === desired.key && environment.isPreview === false,
        );
        return (
          matches.length === 1 && hasExpectedEnvironment(matches[0]!, desired)
        );
      })
    );
  };
  if (
    !(await readEnvironmentsUntil(
      client,
      applicationUuid,
      hasExactEnvironmentSet,
    ))
  ) {
    throw new CoolifyClientError(
      "COOLIFY_ENVIRONMENT_MISMATCH",
      "Coolify did not save the required environment variables",
    );
  }
  return changed;
}

function deploymentState(
  status: CoolifyDeploymentStatus,
): CoolifyDeploymentState {
  if (status === "queued" || status === "in_progress") return "active";
  if (status === "finished") return "finished";
  if (status === "failed") return "failed";
  return "cancelled";
}

function parseDeployment(payload: unknown): CoolifyDeployment {
  const message = "Coolify returned an invalid deployment response";
  if (!isRecord(payload)) invalidResponse(message);
  const deploymentUuid = responseUuid(payload, "deployment_uuid", message);
  const runtimeCommit = responseString(payload, "commit", message);
  if (!COMMIT.test(runtimeCommit)) invalidResponse(message);
  const configHashPayload = payload.configuration_hash;
  const coolifyConfigHash =
    configHashPayload === undefined || configHashPayload === null
      ? null
      : typeof configHashPayload === "string" &&
          COOLIFY_CONFIG_HASH.test(configHashPayload)
        ? configHashPayload
        : invalidResponse(message);
  const statusPayload = payload.status;
  if (
    statusPayload !== "queued" &&
    statusPayload !== "in_progress" &&
    statusPayload !== "finished" &&
    statusPayload !== "failed" &&
    statusPayload !== "cancelled-by-user"
  ) {
    invalidResponse(message);
  }
  const createdAtPayload = payload.created_at;
  const createdAt =
    createdAtPayload === undefined
      ? undefined
      : typeof createdAtPayload === "string" &&
          Number.isFinite(Date.parse(createdAtPayload))
        ? Date.parse(createdAtPayload)
        : invalidResponse(message);
  return {
    deploymentUuid,
    runtimeCommit,
    coolifyConfigHash,
    ...(createdAt === undefined ? {} : { createdAt }),
    status: statusPayload,
    state: deploymentState(statusPayload),
  };
}

async function listApplicationDeployments(
  client: CoolifyTransport,
  applicationUuid: string,
): Promise<CoolifyDeploymentList> {
  const payload = await requestCoolify(client, {
    expectedStatus: 200,
    method: "GET",
    path: `/api/v1/deployments/applications/${encodeURIComponent(applicationUuid)}?skip=0&take=${MAX_DEPLOYMENTS}`,
  });
  const message = "Coolify returned an invalid deployment list";
  if (!isRecord(payload)) invalidResponse(message);
  const count = payload.count;
  const deploymentsPayload = payload.deployments;
  if (
    typeof count !== "number" ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    !Array.isArray(deploymentsPayload) ||
    deploymentsPayload.length > MAX_DEPLOYMENTS ||
    (count <= MAX_DEPLOYMENTS && deploymentsPayload.length !== count)
  ) {
    invalidResponse(message);
  }
  return {
    complete: count <= MAX_DEPLOYMENTS,
    deployments: deploymentsPayload.map(parseDeployment),
  };
}

async function readDeployment(
  client: CoolifyTransport,
  deploymentUuid: string,
): Promise<CoolifyDeployment> {
  return parseDeployment(
    await requestCoolify(client, {
      expectedStatus: 200,
      method: "GET",
      path: `/api/v1/deployments/${encodeURIComponent(deploymentUuid)}`,
    }),
  );
}

async function startDeployment(
  client: CoolifyTransport,
  applicationUuid: string,
): Promise<string> {
  const url = new URL("/api/v1/deploy", client.origin);
  url.searchParams.set("uuid", applicationUuid);
  url.searchParams.set("force", "false");
  const payload = await requestCoolify(client, {
    expectedStatus: 200,
    method: "POST",
    path: `${url.pathname}${url.search}`,
  });
  const message = "Coolify returned an invalid deployment start response";
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.deployments) ||
    payload.deployments.length !== 1 ||
    !isRecord(payload.deployments[0]) ||
    payload.deployments[0].resource_uuid !== applicationUuid
  ) {
    invalidResponse(message);
  }
  return responseUuid(payload.deployments[0], "deployment_uuid", message);
}

export function createCoolifyClient(input: {
  origin: string;
  token: string;
  fetchImpl?: typeof fetch;
}) {
  const client: CoolifyTransport = {
    fetchImpl: input.fetchImpl ?? fetch,
    origin: requireOrigin(input.origin),
    token: requireToken(input.token),
  };

  return {
    async deleteLibraryApplication(input: {
      applicationUuid?: string;
      environmentName: string;
      libraryId: Id<"evidenceLibraries">;
      projectUuid: string;
      publicDomain: string;
      serverUuid: string;
    }): Promise<{
      applicationUuid: string | null;
      outcome: "absent" | "deleted";
    }> {
      const applicationTag = createCoolifyLibraryTag(input.libraryId);
      const savedApplicationUuid = input.applicationUuid
        ? requireInputIdentifier(
            "Coolify application UUID",
            input.applicationUuid,
          )
        : undefined;
      const taggedApplications = await listTaggedApplications(
        client,
        applicationTag,
      );
      if (
        savedApplicationUuid &&
        taggedApplications.length === 1 &&
        taggedApplications[0] !== savedApplicationUuid
      ) {
        throw new CoolifyClientError(
          "COOLIFY_APPLICATION_CONFLICT",
          "The saved Coolify application does not match this library tag",
        );
      }
      const applicationUuid = savedApplicationUuid ?? taggedApplications[0];
      if (!applicationUuid) return { applicationUuid: null, outcome: "absent" };
      const environmentName = requireInputText(
        "Coolify environment name",
        input.environmentName,
      );
      const projectUuid = requireInputIdentifier(
        "Coolify project UUID",
        input.projectUuid,
      );
      const publicDomain = requirePublicDomain(input.publicDomain);
      const serverUuid = requireInputIdentifier(
        "Coolify server UUID",
        input.serverUuid,
      );
      const existing = await readApplicationIfExists(client, applicationUuid);
      if (!existing) return { applicationUuid, outcome: "absent" };
      const application = await readExpectedBoundApplication(client, {
        applicationUuid,
        applicationTag,
        publicDomain,
      });
      if (
        application.environmentName !== environmentName ||
        application.projectUuid !== projectUuid ||
        application.serverUuid !== serverUuid
      ) {
        throw new CoolifyClientError(
          "COOLIFY_APPLICATION_CONFLICT",
          "The bound Coolify application no longer matches this library",
        );
      }
      const url = new URL(
        `/api/v1/applications/${encodeURIComponent(applicationUuid)}`,
        client.origin,
      );
      for (const key of [
        "delete_configurations",
        "delete_volumes",
        "docker_cleanup",
        "delete_connected_networks",
      ]) {
        url.searchParams.set(key, "true");
      }
      await requestCoolify(client, {
        allowNotFound: true,
        expectedStatus: 200,
        method: "DELETE",
        path: `${url.pathname}${url.search}`,
      });
      if (await readApplicationIfExists(client, applicationUuid)) {
        throw new CoolifyClientError(
          "COOLIFY_DELETE_FAILED",
          "Coolify still contains the Evidence Library application",
        );
      }
      return { applicationUuid, outcome: "deleted" };
    },

    async reconcileApplication(input: {
      libraryId: Id<"evidenceLibraries">;
      serverUuid: string;
      projectUuid: string;
      environmentName: string;
      githubAppUuid: string;
      runtimeCommit: string;
      publicDomain: string;
      libraryConfigJson: string;
      meilisearchMasterKey: string;
    }): Promise<CoolifyApplicationResult> {
      const applicationTag = createCoolifyLibraryTag(input.libraryId);
      const serverUuid = requireInputIdentifier(
        "Coolify server UUID",
        input.serverUuid,
      );
      const projectUuid = requireInputIdentifier(
        "Coolify project UUID",
        input.projectUuid,
      );
      const environmentName = requireInputText(
        "Coolify environment name",
        input.environmentName,
      );
      const githubAppUuid = requireInputIdentifier(
        "Coolify GitHub App UUID",
        input.githubAppUuid,
      );
      const runtimeCommit = requireCommit(input.runtimeCommit);
      const publicDomain = requirePublicDomain(input.publicDomain);
      const libraryConfigJson = requireLibraryConfigJson(
        input.libraryConfigJson,
      );
      const meilisearchMasterKey = requireSecret(
        "Meilisearch master key",
        input.meilisearchMasterKey,
      );
      const githubAppId = await readGithubAppId(client, githubAppUuid);
      const desired: DesiredApplication = {
        applicationTag,
        serverUuid,
        projectUuid,
        environmentName,
        githubAppUuid,
        githubAppId,
        runtimeCommit,
        publicDomain,
      };

      const matches = await listTaggedApplications(client, applicationTag);
      let applicationUuid: string;
      let outcome: CoolifyReconcileOutcome;
      if (matches.length === 0) {
        applicationUuid = await createApplication(client, desired);
        outcome = "created";
      } else {
        applicationUuid = matches[0]!;
        outcome = "matched";
      }

      const fields = await reconcileApplicationFields(
        client,
        applicationUuid,
        desired,
      );
      const tagChanged = await reconcileTag(
        client,
        applicationUuid,
        applicationTag,
      );
      const environmentChanged = await reconcileEnvironments(
        client,
        applicationUuid,
        [
          { key: "LIBRARY_CONFIG_JSON", value: libraryConfigJson },
          { key: "MEILISEARCH_MASTER_KEY", value: meilisearchMasterKey },
          { key: "SOURCE_COMMIT", value: runtimeCommit },
        ],
      );
      const finalApplication = await readApplication(client, applicationUuid);
      if (!hasExpectedApplication(finalApplication, desired)) {
        throw new CoolifyClientError(
          "COOLIFY_APPLICATION_MISMATCH",
          "Coolify did not save the required application settings",
        );
      }
      if (
        outcome === "matched" &&
        (fields.changed || tagChanged || environmentChanged)
      ) {
        outcome = "updated";
      }

      return {
        outcome,
        applicationUuid,
        applicationTag,
        runtimeConfigSha256: createHash("sha256")
          .update(libraryConfigJson)
          .digest("hex"),
        coolifyConfigHash: finalApplication.configHash,
      };
    },

    async readBoundApplication(input: {
      applicationUuid: string;
      libraryId: Id<"evidenceLibraries">;
      publicDomain: string;
    }): Promise<CoolifyBoundApplication> {
      const applicationUuid = requireInputIdentifier(
        "Coolify application UUID",
        input.applicationUuid,
      );
      const applicationTag = createCoolifyLibraryTag(input.libraryId);
      const publicDomain = requirePublicDomain(input.publicDomain);
      const application = await readExpectedBoundApplication(client, {
        applicationUuid,
        applicationTag,
        publicDomain,
      });
      return {
        applicationUuid,
        runtimeCommit: application.gitCommitSha,
        coolifyConfigHash: application.configHash,
      };
    },

    async requireBoundApplicationConfiguration(input: {
      applicationUuid: string;
      libraryId: Id<"evidenceLibraries">;
      publicDomain: string;
      runtimeCommit: string;
      libraryConfigJson: string;
    }): Promise<CoolifyBoundApplication> {
      const applicationUuid = requireInputIdentifier(
        "Coolify application UUID",
        input.applicationUuid,
      );
      const applicationTag = createCoolifyLibraryTag(input.libraryId);
      const publicDomain = requirePublicDomain(input.publicDomain);
      const runtimeCommit = requireCommit(input.runtimeCommit);
      const libraryConfigJson = requireLibraryConfigJson(
        input.libraryConfigJson,
      );
      const application = await readExpectedBoundApplication(client, {
        applicationUuid,
        applicationTag,
        publicDomain,
      });
      if (application.gitCommitSha !== runtimeCommit) {
        throw new CoolifyClientError(
          "COOLIFY_APPLICATION_CONFLICT",
          "The bound Coolify application changed after deployment started",
        );
      }
      await requireEnvironmentReadback(client, applicationUuid, {
        key: "LIBRARY_CONFIG_JSON",
        value: libraryConfigJson,
      });
      await requireEnvironmentReadback(client, applicationUuid, {
        key: "SOURCE_COMMIT",
        value: runtimeCommit,
      });
      const finalApplication = await readExpectedBoundApplication(client, {
        applicationUuid,
        applicationTag,
        publicDomain,
      });
      if (finalApplication.gitCommitSha !== runtimeCommit) {
        throw new CoolifyClientError(
          "COOLIFY_APPLICATION_CONFLICT",
          "The bound Coolify application changed during configuration readback",
        );
      }
      return {
        applicationUuid,
        runtimeCommit,
        coolifyConfigHash: finalApplication.configHash,
      };
    },

    // Points the bound application at another Evidence Library commit. The
    // next deployment builds that commit. Nothing is deployed here.
    async setApplicationCommit(input: {
      applicationUuid: string;
      libraryId: Id<"evidenceLibraries">;
      publicDomain: string;
      runtimeCommit: string;
    }): Promise<CoolifyBoundApplication> {
      const applicationUuid = requireInputIdentifier(
        "Coolify application UUID",
        input.applicationUuid,
      );
      const applicationTag = createCoolifyLibraryTag(input.libraryId);
      const publicDomain = requirePublicDomain(input.publicDomain);
      const runtimeCommit = requireCommit(input.runtimeCommit);
      let application = await readExpectedBoundApplication(client, {
        applicationUuid,
        applicationTag,
        publicDomain,
      });
      if (application.gitCommitSha !== runtimeCommit) {
        parseUuidResponse(
          await requestCoolify(client, {
            expectedStatus: 200,
            method: "PATCH",
            path: `/api/v1/applications/${encodeURIComponent(applicationUuid)}`,
            body: { git_commit_sha: runtimeCommit, instant_deploy: false },
          }),
          applicationUuid,
        );
        application = await readExpectedBoundApplication(client, {
          applicationUuid,
          applicationTag,
          publicDomain,
        });
        if (application.gitCommitSha !== runtimeCommit) {
          throw new CoolifyClientError(
            "COOLIFY_APPLICATION_MISMATCH",
            "Coolify did not save the requested Evidence Library commit",
          );
        }
      }
      return {
        applicationUuid,
        runtimeCommit,
        coolifyConfigHash: application.configHash,
      };
    },

    async updateApplicationConfiguration(input: {
      applicationUuid: string;
      libraryId: Id<"evidenceLibraries">;
      publicDomain: string;
      libraryConfigJson: string;
      expectedRuntimeCommit: string;
    }): Promise<CoolifyConfigurationUpdateResult> {
      const applicationUuid = requireInputIdentifier(
        "Coolify application UUID",
        input.applicationUuid,
      );
      const applicationTag = createCoolifyLibraryTag(input.libraryId);
      const publicDomain = requirePublicDomain(input.publicDomain);
      const libraryConfigJson = requireLibraryConfigJson(
        input.libraryConfigJson,
      );
      const expectedRuntimeCommit = requireCommit(input.expectedRuntimeCommit);
      const application = await readExpectedBoundApplication(client, {
        applicationUuid,
        applicationTag,
        publicDomain,
      });
      if (application.gitCommitSha !== expectedRuntimeCommit) {
        throw new CoolifyClientError(
          "COOLIFY_APPLICATION_CONFLICT",
          "The bound Coolify application no longer matches this library",
        );
      }
      await reconcileEnvironmentValue(client, applicationUuid, {
        key: "LIBRARY_CONFIG_JSON",
        value: libraryConfigJson,
      });
      await reconcileEnvironmentValue(client, applicationUuid, {
        key: "SOURCE_COMMIT",
        value: expectedRuntimeCommit,
      });
      const finalApplication = await readExpectedBoundApplication(client, {
        applicationUuid,
        applicationTag,
        publicDomain,
      });
      if (
        finalApplication.uuid !== applicationUuid ||
        finalApplication.gitCommitSha !== application.gitCommitSha ||
        !hasExpectedBoundApplication(
          finalApplication,
          applicationTag,
          publicDomain,
        )
      ) {
        throw new CoolifyClientError(
          "COOLIFY_APPLICATION_CONFLICT",
          "The bound Coolify application changed during configuration update",
        );
      }
      return {
        applicationUuid,
        runtimeCommit: application.gitCommitSha,
        runtimeConfigSha256: createHash("sha256")
          .update(libraryConfigJson)
          .digest("hex"),
        coolifyConfigHash: finalApplication.configHash,
      };
    },

    async listApplicationDeployments(
      applicationUuid: string,
    ): Promise<CoolifyDeploymentList> {
      return await listApplicationDeployments(
        client,
        requireInputIdentifier("Coolify application UUID", applicationUuid),
      );
    },

    async startOrAdoptDeployment(input: {
      applicationUuid: string;
      runtimeCommit: string;
      coolifyConfigHash: string;
      notBefore?: number;
    }): Promise<CoolifyDeploymentSelection> {
      const applicationUuid = requireInputIdentifier(
        "Coolify application UUID",
        input.applicationUuid,
      );
      const runtimeCommit = requireCommit(input.runtimeCommit);
      const coolifyConfigHash = requireConfigHash(input.coolifyConfigHash);
      const notBefore =
        input.notBefore === undefined
          ? undefined
          : requireAdoptionBoundary(input.notBefore);
      const application = await readApplication(client, applicationUuid);
      if (
        application.uuid !== applicationUuid ||
        application.gitCommitSha !== runtimeCommit ||
        application.configHash !== coolifyConfigHash
      ) {
        throw new CoolifyClientError(
          "COOLIFY_DEPLOYMENT_CONFLICT",
          "The Coolify application changed before deployment",
        );
      }
      if (coolifyConfigHash.length === 32) {
        return {
          outcome: "started",
          applicationUuid,
          deploymentUuid: await startDeployment(client, applicationUuid),
          runtimeCommit,
          coolifyConfigHash,
        };
      }
      const listed = await listApplicationDeployments(client, applicationUuid);
      let missingConfigurationHash = false;
      for (const deployment of listed.deployments) {
        if (
          notBefore !== undefined &&
          (deployment.createdAt === undefined ||
            deployment.createdAt < notBefore)
        ) {
          continue;
        }
        if (deployment.runtimeCommit !== runtimeCommit) continue;
        if (
          deployment.coolifyConfigHash === null &&
          (deployment.state === "active" || deployment.state === "finished")
        ) {
          missingConfigurationHash = true;
          continue;
        }
        if (
          deployment.coolifyConfigHash === coolifyConfigHash &&
          deployment.state !== "failed" &&
          deployment.state !== "cancelled"
        ) {
          return {
            outcome: "adopted",
            applicationUuid,
            deployment,
          };
        }
      }
      if (missingConfigurationHash && listed.complete) {
        return {
          outcome: "adoption-unavailable",
          applicationUuid,
          reason: "configuration-hash-missing",
        };
      }

      return {
        outcome: "started",
        applicationUuid,
        deploymentUuid: await startDeployment(client, applicationUuid),
        runtimeCommit,
        coolifyConfigHash,
      };
    },

    async readDeployment(deploymentUuid: string): Promise<CoolifyDeployment> {
      return await readDeployment(
        client,
        requireInputIdentifier("Coolify deployment UUID", deploymentUuid),
      );
    },

    async requireFinishedDeployment(input: {
      deploymentUuid: string;
      runtimeCommit: string;
      coolifyConfigHash: string;
    }): Promise<CoolifyDeployment> {
      const deploymentUuid = requireInputIdentifier(
        "Coolify deployment UUID",
        input.deploymentUuid,
      );
      const runtimeCommit = requireCommit(input.runtimeCommit);
      const coolifyConfigHash = requireConfigHash(input.coolifyConfigHash);
      const deployment = await readDeployment(client, deploymentUuid);
      if (
        deployment.runtimeCommit !== runtimeCommit ||
        deployment.coolifyConfigHash !== coolifyConfigHash
      ) {
        throw new CoolifyClientError(
          "COOLIFY_DEPLOYMENT_CONFLICT",
          "The Coolify deployment does not match the saved release",
        );
      }
      if (deployment.state !== "finished") {
        throw new CoolifyClientError(
          "COOLIFY_DEPLOYMENT_NOT_FINISHED",
          "The Coolify deployment is not finished",
        );
      }
      return deployment;
    },
  };
}

export async function reconcileCoolifyApplication(input: {
  coolifyUrl: string;
  token: string;
  serverUuid: string;
  projectUuid: string;
  environmentName: string;
  githubAppUuid: string;
  libraryId: Id<"evidenceLibraries">;
  targetBaseUrl: string;
  runtimeCommit: string;
  runtimeConfigJson: string;
  searchKey: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  outcome: CoolifyReconcileOutcome;
  applicationId: string;
  coolifyConfigHash: string;
}> {
  const result = await createCoolifyClient({
    origin: input.coolifyUrl,
    token: input.token,
    fetchImpl: input.fetchImpl,
  }).reconcileApplication({
    libraryId: input.libraryId,
    serverUuid: input.serverUuid,
    projectUuid: input.projectUuid,
    environmentName: input.environmentName,
    githubAppUuid: input.githubAppUuid,
    runtimeCommit: input.runtimeCommit,
    publicDomain: input.targetBaseUrl,
    libraryConfigJson: input.runtimeConfigJson,
    meilisearchMasterKey: input.searchKey,
  });
  return {
    outcome: result.outcome,
    applicationId: result.applicationUuid,
    coolifyConfigHash: result.coolifyConfigHash,
  };
}
