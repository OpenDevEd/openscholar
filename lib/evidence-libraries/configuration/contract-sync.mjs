import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const EXACT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const execFileAsync = promisify(execFile);

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizeGitHubRepository(remote) {
  const trimmed = remote.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const sshMatch = /^git@github\.com:([^/]+\/[^/]+)$/.exec(trimmed);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  const sshUrlMatch = /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+)$/.exec(trimmed);
  if (sshUrlMatch) return `https://github.com/${sshUrlMatch[1]}`;
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(trimmed)) return trimmed;
  throw new Error(`Unsupported Evidence Library origin: ${remote.trim()}`);
}

export async function inspectContractCheckout({
  sourceRoot,
  expectedRepository,
  expectedBranch,
  artifactCommit,
}) {
  const [{ stdout: rawRemote }, { stdout: rawBranch }] = await Promise.all([
    execFileAsync("git", ["-C", sourceRoot, "remote", "get-url", "origin"], {
      encoding: "utf8",
    }),
    execFileAsync("git", ["-C", sourceRoot, "branch", "--show-current"], {
      encoding: "utf8",
    }),
  ]);
  const repository = normalizeGitHubRepository(rawRemote);
  const branch = rawBranch.trim();

  if (repository !== expectedRepository) {
    throw new Error(
      `Evidence Library checkout origin mismatch: expected ${expectedRepository}, received ${repository}`,
    );
  }
  if (branch !== expectedBranch) {
    throw new Error(
      `Evidence Library checkout branch mismatch: expected ${expectedBranch}, received ${branch}`,
    );
  }
  if (!EXACT_COMMIT_PATTERN.test(artifactCommit)) {
    throw new Error("Evidence Library artifact commit must be an exact 40-character commit SHA");
  }

  const remoteBranchRef = `refs/remotes/origin/${expectedBranch}`;
  try {
    await execFileAsync("git", [
      "-C",
      sourceRoot,
      "show-ref",
      "--verify",
      "--quiet",
      remoteBranchRef,
    ]);
  } catch {
    throw new Error(`Evidence Library checkout is missing ${remoteBranchRef}`);
  }

  try {
    await execFileAsync("git", [
      "-C",
      sourceRoot,
      "merge-base",
      "--is-ancestor",
      artifactCommit,
      remoteBranchRef,
    ]);
  } catch {
    throw new Error(
      `Evidence Library artifact commit ${artifactCommit} is not present in origin/${expectedBranch}`,
    );
  }

  return { repository };
}

export async function readContractArtifactsAtCommit({ sourceRoot, commit }) {
  if (!EXACT_COMMIT_PATTERN.test(commit)) {
    throw new Error("Evidence Library revision must be an exact 40-character commit SHA");
  }

  await execFileAsync("git", ["-C", sourceRoot, "cat-file", "-e", `${commit}^{commit}`]);
  const options = { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 };
  const [{ stdout: schemaText }, { stdout: catalogText }] = await Promise.all([
    execFileAsync(
      "git",
      ["-C", sourceRoot, "show", `${commit}:public/library-config.schema.json`],
      options,
    ),
    execFileAsync(
      "git",
      ["-C", sourceRoot, "show", `${commit}:public/library-config.catalogs.json`],
      options,
    ),
  ]);

  return { schemaText, catalogText };
}

export function createContractSnapshot({
  repository,
  commit,
  schemaText,
  catalogText,
  expectedDigests = {},
}) {
  if (typeof repository !== "string" || repository.trim() === "") {
    throw new Error("Evidence Library repository provenance is required");
  }

  if (!EXACT_COMMIT_PATTERN.test(commit)) {
    throw new Error("Evidence Library revision must be an exact 40-character commit SHA");
  }

  const schemaDigest = sha256(schemaText);
  const catalogDigest = sha256(catalogText);

  if (expectedDigests.schema && expectedDigests.schema !== schemaDigest) {
    throw new Error("Evidence Library schema digest mismatch");
  }
  if (expectedDigests.catalogs && expectedDigests.catalogs !== catalogDigest) {
    throw new Error("Evidence Library catalogs digest mismatch");
  }

  const schema = JSON.parse(schemaText);
  const catalog = JSON.parse(catalogText);
  const schemaVersion = schema?.properties?.schemaVersion?.const;

  if (schemaVersion !== catalog.schemaVersion) {
    throw new Error("Evidence Library schema version mismatch between generated artifacts");
  }
  if (schema.$schema !== JSON_SCHEMA_2020_12) {
    throw new Error("Evidence Library contract must use JSON Schema draft 2020-12");
  }

  return {
    lock: {
      formatVersion: 1,
      source: { repository, commit },
      contract: {
        schemaVersion,
        catalogVersion: catalog.catalogVersion,
        jsonSchemaDraft: schema.$schema,
      },
      artifacts: {
        schema: {
          path: "generated/library-config.schema.json",
          bytes: Buffer.byteLength(schemaText, "utf8"),
          sha256: schemaDigest,
        },
        catalogs: {
          path: "generated/library-config.catalogs.json",
          bytes: Buffer.byteLength(catalogText, "utf8"),
          sha256: catalogDigest,
        },
      },
    },
    schemaText,
    catalogText,
  };
}

function renderContractFiles(snapshot) {
  const lock = snapshot.lock;
  const readme = `# Generated Evidence Library configuration contract

DO NOT EDIT these files by hand. Regenerate them with
\`node scripts/sync-evidence-library-config-contract.mjs --commit ${lock.source.commit}\`.

- Repository: ${lock.source.repository}
- Artifact commit: \`${lock.source.commit}\`
`;

  return new Map([
    ["contract-lock.json", `${JSON.stringify(lock, null, 2)}\n`],
    ["generated/README.md", readme],
    ["generated/library-config.schema.json", snapshot.schemaText],
    ["generated/library-config.catalogs.json", snapshot.catalogText],
  ]);
}

export async function synchronizeContractSnapshot({
  snapshot,
  outputRoot,
  check,
}) {
  const files = renderContractFiles(snapshot);

  if (check) {
    const drifted = [];
    for (const [relativePath, expected] of files) {
      try {
        const actual = await readFile(join(outputRoot, relativePath), "utf8");
        if (actual !== expected) drifted.push(relativePath);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          drifted.push(relativePath);
          continue;
        }
        throw error;
      }
    }
    if (drifted.length > 0) {
      throw new Error(`Evidence Library contract drift detected: ${drifted.join(", ")}`);
    }
    return { changed: false };
  }

  for (const [relativePath, contents] of files) {
    const destination = join(outputRoot, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents, "utf8");
  }

  return { changed: true };
}
