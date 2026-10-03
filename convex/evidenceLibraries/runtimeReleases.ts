// Reads the newest published Evidence Library release from GitHub, the notes
// written for each release since a library's runtime, and the commits between
// the two. The repository is private, so every request carries a token.
//
// A release is a GitHub Release tagged `runtime-<commit>`. new-el publishes
// one only after the runtime image and its plain-language notes both exist.

import {
  resolveRuntimeImage,
  RuntimeImageRegistryError,
  type RuntimeImageReference,
} from "./runtimeImageRegistry";
import { MAX_RELEASES, MAX_RELEASE_CHANGES as MAX_CHANGES, MAX_RELEASE_NOTES as MAX_NOTES } from "../lib/listCaps";

const GITHUB_ORIGIN = "https://api.github.com";
const RUNTIME_REPOSITORY = "OpenDevEd/new-el";
const RUNTIME_RELEASE_TAG = /^runtime-([a-f0-9]{40})$/u;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 200;
const MAX_NOTE_LENGTH = 300;
const COMMIT = /^[a-f0-9]{40}$/u;

export const RUNTIME_RELEASE_CACHE_MS = 10 * 60 * 1_000;

export type RuntimeReleaseChange = { sha: string; message: string };
export type RuntimeReleaseNotes = {
  commit: string;
  summary: string;
  notes: string[];
};
export type RecommendedRuntimeRelease = {
  latest: string;
  image: RuntimeImageReference;
  releases: RuntimeReleaseNotes[];
};
export type RuntimeRelease = {
  latest: string;
  image: RuntimeImageReference;
  changes: RuntimeReleaseChange[];
  releases: RuntimeReleaseNotes[];
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

/**
 * The release body as new-el writes it: a one-line summary, then one `- `
 * line per note. Any other line, such as the image reference, is ignored.
 */
export function parseReleaseNotes(body: unknown): {
  summary: string;
  notes: string[];
} {
  const lines =
    typeof body === "string"
      ? body
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter((line) => line !== "")
      : [];
  const summary = lines.find((line) => !line.startsWith("- ")) ?? "";
  const notes = lines
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim().slice(0, MAX_NOTE_LENGTH))
    .filter((line) => line !== "")
    .slice(0, MAX_NOTES);
  return { summary: summary.slice(0, MAX_NOTE_LENGTH), notes };
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

export async function fetchRecommendedRuntimeRelease(input: {
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<RecommendedRuntimeRelease> {
  const token = input.token.trim();
  if (!token) {
    throw new RuntimeReleaseError(
      "GITHUB_TOKEN_MISSING",
      "GITHUB_TOKEN is not configured",
    );
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await readGithub(
    fetchImpl,
    token,
    `/repos/${RUNTIME_REPOSITORY}/releases?per_page=${MAX_RELEASES}`,
  );
  const published: { publishedAt: number; release: RuntimeReleaseNotes }[] = [];
  if (response.status === 200 && Array.isArray(response.body)) {
    for (const entry of response.body) {
      if (!isRecord(entry) || entry.draft === true || entry.prerelease === true)
        continue;
      const commit =
        typeof entry.tag_name === "string"
          ? RUNTIME_RELEASE_TAG.exec(entry.tag_name)?.[1]
          : undefined;
      if (!commit) continue;
      const publishedAt =
        typeof entry.published_at === "string"
          ? Date.parse(entry.published_at)
          : NaN;
      if (!Number.isFinite(publishedAt)) continue;
      published.push({
        publishedAt,
        release: { commit, ...parseReleaseNotes(entry.body) },
      });
    }
  }
  // The API can list an older release first. Use publication dates.
  const releases = published
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .map(({ release }) => release);
  const newest = releases[0];
  if (!newest) {
    throw new RuntimeReleaseError(
      "GITHUB_UNAVAILABLE",
      "The latest Evidence Library release could not be read",
    );
  }
  const latest = newest.commit;
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
      "RUNTIME_IMAGE_UNAVAILABLE",
      "The Evidence Library software image could not be read right now",
    );
  }
  return { latest, image, releases };
}

export async function fetchRuntimeRelease(input: {
  running: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<RuntimeRelease> {
  const running = requireCommit("running commit", input.running);
  const token = input.token.trim();
  const fetchImpl = input.fetchImpl ?? fetch;
  const { latest, image, releases } = await fetchRecommendedRuntimeRelease({
    token,
    fetchImpl,
  });
  if (latest === running) return { latest, image, changes: [], releases: [] };

  const compare = await readGithub(
    fetchImpl,
    token,
    `/repos/${RUNTIME_REPOSITORY}/compare/${running}...${latest}`,
  );
  // 404 means the running commit is no longer on the branch. The update is
  // still available; only the newest notes are known to apply.
  if (compare.status === 404) {
    return {
      latest,
      image,
      changes: [],
      releases: releases.filter((release) => release.commit === latest),
    };
  }
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
  // The releases the library has not applied yet are the ones whose commits
  // lie between its runtime and the latest release. A library that runs a
  // commit which was never released is covered the same way.
  const ahead = new Set(changes.map((change) => change.sha));
  return {
    latest,
    image,
    changes,
    releases: releases.filter((release) => ahead.has(release.commit)),
  };
}

/**
 * Whether a runtime commit is `commit` or comes after it on new-el's branch,
 * so it reads every configuration field `commit` introduced. A runtime commit
 * GitHub cannot place, such as one no longer on the branch, counts as older.
 */
export async function runtimeIncludesCommit(input: {
  runtime: string;
  commit: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const runtime = requireCommit("runtime commit", input.runtime);
  const commit = requireCommit("contract commit", input.commit);
  if (runtime === commit) return true;
  const compare = await readGithub(
    input.fetchImpl ?? fetch,
    input.token.trim(),
    `/repos/${RUNTIME_REPOSITORY}/compare/${commit}...${runtime}`,
  );
  if (compare.status === 404) return false;
  if (
    compare.status !== 200 ||
    !isRecord(compare.body) ||
    typeof compare.body.status !== "string"
  ) {
    throw new RuntimeReleaseError(
      "GITHUB_UNAVAILABLE",
      "The Evidence Library software history could not be read",
    );
  }
  return compare.body.status === "ahead" || compare.body.status === "identical";
}
