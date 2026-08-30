// Reads the newest Evidence Library software commit from GitHub and the list
// of commits between the commit a library runs and that newest commit.
// The repository is private, so every request carries a token.

import {
  resolveRuntimeImage,
  RuntimeImageRegistryError,
  type RuntimeImageReference,
} from "./runtimeImageRegistry";

const GITHUB_ORIGIN = "https://api.github.com";
const RUNTIME_REPOSITORY = "OpenDevEd/new-el";
const RUNTIME_BRANCH = "main";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CHANGES = 250;
const MAX_MESSAGE_LENGTH = 200;
const COMMIT = /^[a-f0-9]{40}$/u;

export const RUNTIME_RELEASE_CACHE_MS = 10 * 60 * 1_000;

export type RuntimeReleaseChange = { sha: string; message: string };
export type RuntimeRelease = {
  latest: string;
  image: RuntimeImageReference;
  changes: RuntimeReleaseChange[];
};

export class RuntimeReleaseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeReleaseError";
  }
}

export function isFreshRuntimeRelease(checkedAt: number, now: number) {
  return now - checkedAt < RUNTIME_RELEASE_CACHE_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireCommit(label: string, value: unknown): string {
  if (typeof value !== "string" || !COMMIT.test(value)) {
    throw new RuntimeReleaseError(
      "GITHUB_INVALID_RESPONSE",
      `${label} is not a commit`,
    );
  }
  return value;
}

function firstLine(message: unknown): string {
  if (typeof message !== "string") return "";
  const line = message.split("\n", 1)[0]?.trim() ?? "";
  return line.slice(0, MAX_MESSAGE_LENGTH);
}

async function readGithub(
  fetchImpl: typeof fetch,
  token: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, GITHUB_ORIGIN), {
        method: "GET",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": "OpenScholar",
          "x-github-api-version": "2022-11-28",
        },
        signal: controller.signal,
      });
    } catch {
      throw new RuntimeReleaseError(
        "GITHUB_UNAVAILABLE",
        "GitHub could not be reached",
      );
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_RESPONSE_BYTES
    ) {
      throw new RuntimeReleaseError(
        "GITHUB_INVALID_RESPONSE",
        "GitHub returned too much data",
      );
    }
    let body: unknown = null;
    try {
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        throw new Error("too large");
      }
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new RuntimeReleaseError(
        "GITHUB_INVALID_RESPONSE",
        "GitHub returned invalid JSON",
      );
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchRuntimeRelease(input: {
  running: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<RuntimeRelease> {
  const running = requireCommit("running commit", input.running);
  const token = input.token.trim();
  if (!token) {
    throw new RuntimeReleaseError(
      "GITHUB_TOKEN_MISSING",
      "GITHUB_TOKEN is not configured",
    );
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const head = await readGithub(
    fetchImpl,
    token,
    `/repos/${RUNTIME_REPOSITORY}/commits/${RUNTIME_BRANCH}`,
  );
  if (head.status !== 200 || !isRecord(head.body)) {
    throw new RuntimeReleaseError(
      "GITHUB_UNAVAILABLE",
      "The latest Evidence Library commit could not be read",
    );
  }
  const latest = requireCommit("latest commit", head.body.sha);
  let image: RuntimeImageReference | null;
  try {
    image = await resolveRuntimeImage({
      commit: latest,
      githubToken: token,
      fetchImpl,
    });
  } catch (error) {
    if (error instanceof RuntimeImageRegistryError) {
      throw new RuntimeReleaseError(error.code, error.message);
    }
    throw error;
  }
  if (!image) {
    throw new RuntimeReleaseError(
      "RUNTIME_IMAGE_PENDING",
      "The newest Evidence Library update is still being prepared",
    );
  }
  if (latest === running) return { latest, image, changes: [] };

  const compare = await readGithub(
    fetchImpl,
    token,
    `/repos/${RUNTIME_REPOSITORY}/compare/${running}...${latest}`,
  );
  // 404 means the running commit is no longer on the branch. The update is
  // still available; only the change list is unknown.
  if (compare.status === 404) return { latest, image, changes: [] };
  if (
    compare.status !== 200 ||
    !isRecord(compare.body) ||
    !Array.isArray(compare.body.commits)
  ) {
    throw new RuntimeReleaseError(
      "GITHUB_UNAVAILABLE",
      "The Evidence Library change list could not be read",
    );
  }
  const changes: RuntimeReleaseChange[] = [];
  for (const entry of compare.body.commits.slice(0, MAX_CHANGES)) {
    if (!isRecord(entry) || !isRecord(entry.commit)) continue;
    changes.push({
      sha: requireCommit("change commit", entry.sha),
      message: firstLine(entry.commit.message),
    });
  }
  return { latest, image, changes };
}
