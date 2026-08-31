import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import standaloneCode from "ajv/dist/standalone/index.js";

const EXACT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const execFileAsync = promisify(execFile);

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function iconAssetsDigest(iconFiles) {
  const hash = createHash("sha256");
  for (const [name, contents] of [...iconFiles].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    hash
      .update(name, "utf8")
      .update("\0")
      .update(contents, "utf8")
      .update("\0");
  }
  return hash.digest("hex");
}

function validateIconFiles(iconFiles) {
  if (!(iconFiles instanceof Map) || !iconFiles.has("catalog.json")) {
    throw new Error("Evidence Library icon assets must include catalog.json");
  }
  const catalog = JSON.parse(iconFiles.get("catalog.json"));
  const shards = new Set(Object.values(catalog));
  const expectedNames = new Set([
    "catalog.json",
    ...[...shards].map((shard) => `${shard}.svg`),
  ]);
  if (
    [...shards].some((shard) => !/^[0-9a-f]{2}$/.test(shard)) ||
    iconFiles.size !== expectedNames.size ||
    [...expectedNames].some((name) => !iconFiles.has(name))
  ) {
    throw new Error("Evidence Library icon assets do not match their catalog");
  }
}

function createClientArtifacts(schema, catalog) {
  const iconIds = schema.$defs?.PlatformNavbarIconId?.enum;
  if (!Array.isArray(iconIds) || iconIds.length === 0) {
    throw new Error("Evidence Library schema has no platform navbar icon enum");
  }
  if (!Array.isArray(catalog.options?.navbarIconIds)) {
    throw new Error("Evidence Library catalog has no platform navbar icon list");
  }
  const clientSchema = structuredClone(schema);
  clientSchema.$defs.PlatformNavbarIconId = {
    type: "string",
    pattern: "^[A-Za-z0-9]+Icon$",
  };
  const clientCatalog = structuredClone(catalog);
  delete clientCatalog.options.navbarIconIds;
  const clientSchemaText = `${JSON.stringify(clientSchema)}\n`;
  const clientCatalogText = `${JSON.stringify(clientCatalog)}\n`;
  if (clientSchemaText.includes(iconIds[0]) || clientCatalogText.includes(iconIds[0])) {
    throw new Error("Evidence Library browser artifacts still contain the platform icon enum");
  }
  return {
    clientSchemaText,
    clientCatalogText,
  };
}

const ENVELOPE_FIELDS = new Set(["schemaVersion", "revision", "updatedAt"]);

export function listSchemaSectionKeys(schema) {
  return Object.keys(schema.properties ?? {}).filter(
    (key) => !ENVELOPE_FIELDS.has(key),
  );
}

function sectionExportName(key) {
  return `section_${key}`;
}

// One precompiled validator per top-level section, compiled from the schema
// slice at that section, plus the full validator. Convex cannot compile JSON
// Schema at runtime, so both are generated here. Measured on the pinned
// contract: the full validator alone is about 410 KB, the bundle with all
// section validators about 785 KB.
function compileStandaloneValidators(schema) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    code: { source: true },
  });
  ajv.addKeyword("x-runtimeValidation");
  ajv.addKeyword("x-dynamicDefault");
  addFormats(ajv);
  ajv.addSchema(schema, "full");
  const sectionKeys = listSchemaSectionKeys(schema);
  const exportMap = { fullValidator: "full" };
  for (const key of sectionKeys) {
    ajv.addSchema(
      {
        $schema: schema.$schema,
        $defs: schema.$defs,
        ...schema.properties[key],
      },
      sectionExportName(key),
    );
    exportMap[sectionExportName(key)] = sectionExportName(key);
  }
  const sectionMap = sectionKeys
    .map(
      (key) => `  ${JSON.stringify(key)}: exports.${sectionExportName(key)},`,
    )
    .join("\n");
  return `${standaloneCode(ajv, exportMap)}\nexports.sectionValidators = Object.freeze({\n${sectionMap}\n});\n`;
}

function normalizeGitHubRepository(remote) {
  const trimmed = remote
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
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
    throw new Error(
      "Evidence Library artifact commit must be an exact 40-character commit SHA",
    );
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
    throw new Error(
      "Evidence Library revision must be an exact 40-character commit SHA",
    );
  }

  await execFileAsync("git", [
    "-C",
    sourceRoot,
    "cat-file",
    "-e",
    `${commit}^{commit}`,
  ]);
  const options = { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 };
  const [
    { stdout: schemaText },
    { stdout: catalogText },
    { stdout: iconNamesText },
  ] = await Promise.all([
    execFileAsync(
      "git",
      ["-C", sourceRoot, "show", `${commit}:public/library-config.schema.json`],
      options,
    ),
    execFileAsync(
      "git",
      [
        "-C",
        sourceRoot,
        "show",
        `${commit}:public/library-config.catalogs.json`,
      ],
      options,
    ),
    execFileAsync(
      "git",
      [
        "-C",
        sourceRoot,
        "ls-tree",
        "--name-only",
        `${commit}:public/library-icons`,
      ],
      options,
    ),
  ]);

  const iconNames = iconNamesText.trim().split("\n").filter(Boolean);
  const iconFiles = new Map(
    await Promise.all(
      iconNames.map(async (name) => {
        const { stdout } = await execFileAsync(
          "git",
          ["-C", sourceRoot, "show", `${commit}:public/library-icons/${name}`],
          options,
        );
        return [name, stdout];
      }),
    ),
  );
  validateIconFiles(iconFiles);

  return { schemaText, catalogText, iconFiles };
}

export function createContractSnapshot({
  repository,
  commit,
  schemaText,
  catalogText,
  iconFiles = new Map(),
  expectedDigests = {},
}) {
  if (typeof repository !== "string" || repository.trim() === "") {
    throw new Error("Evidence Library repository provenance is required");
  }

  if (!EXACT_COMMIT_PATTERN.test(commit)) {
    throw new Error(
      "Evidence Library revision must be an exact 40-character commit SHA",
    );
  }

  const schemaDigest = sha256(schemaText);
  const catalogDigest = sha256(catalogText);
  const iconsDigest =
    iconFiles.size > 0 ? iconAssetsDigest(iconFiles) : undefined;

  if (expectedDigests.schema && expectedDigests.schema !== schemaDigest) {
    throw new Error("Evidence Library schema digest mismatch");
  }
  if (expectedDigests.catalogs && expectedDigests.catalogs !== catalogDigest) {
    throw new Error("Evidence Library catalogs digest mismatch");
  }
  if (expectedDigests.icons && expectedDigests.icons !== iconsDigest) {
    throw new Error("Evidence Library icon assets digest mismatch");
  }
  if (iconFiles.size > 0) validateIconFiles(iconFiles);

  const schema = JSON.parse(schemaText);
  const catalog = JSON.parse(catalogText);
  const schemaVersion = schema?.properties?.schemaVersion?.const;

  if (schemaVersion !== catalog.schemaVersion) {
    throw new Error(
      "Evidence Library schema version mismatch between generated artifacts",
    );
  }
  if (schema.$schema !== JSON_SCHEMA_2020_12) {
    throw new Error(
      "Evidence Library contract must use JSON Schema draft 2020-12",
    );
  }
  const validatorText = compileStandaloneValidators(schema);
  const { clientSchemaText, clientCatalogText } = createClientArtifacts(
    schema,
    catalog,
  );

  return {
    lock: {
      formatVersion: iconFiles.size > 0 ? 3 : 2,
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
        validator: {
          path: "generated/library-config.validator.cjs",
          bytes: Buffer.byteLength(validatorText, "utf8"),
          sha256: sha256(validatorText),
        },
        clientSchema: {
          path: "generated/library-config.client.schema.json",
          bytes: Buffer.byteLength(clientSchemaText, "utf8"),
          sha256: sha256(clientSchemaText),
        },
        clientCatalogs: {
          path: "generated/library-config.client.catalogs.json",
          bytes: Buffer.byteLength(clientCatalogText, "utf8"),
          sha256: sha256(clientCatalogText),
        },
        ...(iconsDigest
          ? {
              icons: {
                path: "public/library-icons",
                files: iconFiles.size,
                bytes: [...iconFiles.values()].reduce(
                  (total, contents) =>
                    total + Buffer.byteLength(contents, "utf8"),
                  0,
                ),
                sha256: iconsDigest,
              },
            }
          : {}),
      },
    },
    schemaText,
    catalogText,
    clientSchemaText,
    clientCatalogText,
    validatorText,
    iconFiles,
    validatorTypesText: `import type { ValidateFunction } from "ajv";\n\nexport const fullValidator: ValidateFunction<unknown>;\nexport const sectionValidators: Readonly<Record<string, ValidateFunction<unknown>>>;\n`,
  };
}

function renderContractFiles(snapshot) {
  const lock = snapshot.lock;
  const readme = `# Generated Evidence Library configuration contract

DO NOT EDIT these files by hand. Regenerate them with
\`node scripts/sync-evidence-library-config-contract.mjs --commit ${lock.source.commit}\`.

- Repository: ${lock.source.repository}
- Artifact commit: \`${lock.source.commit}\`

The validator is precompiled because Convex does not allow runtime code generation.
`;

  return new Map([
    ["contract-lock.json", `${JSON.stringify(lock, null, 2)}\n`],
    ["generated/README.md", readme],
    ["generated/library-config.schema.json", snapshot.schemaText],
    ["generated/library-config.catalogs.json", snapshot.catalogText],
    ["generated/library-config.client.schema.json", snapshot.clientSchemaText],
    [
      "generated/library-config.client.catalogs.json",
      snapshot.clientCatalogText,
    ],
    ["generated/library-config.validator.cjs", snapshot.validatorText],
    ["generated/library-config.validator.d.cts", snapshot.validatorTypesText],
  ]);
}

/**
 * @param {{ snapshot: any, outputRoot: string, iconOutputRoot?: string, check: boolean }} input
 */
export async function synchronizeContractSnapshot({
  snapshot,
  outputRoot,
  iconOutputRoot,
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
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          drifted.push(relativePath);
          continue;
        }
        throw error;
      }
    }
    if (snapshot.iconFiles.size > 0) {
      if (!iconOutputRoot) throw new Error("Icon output root is required");
      const actualNames = await readdir(iconOutputRoot).catch(() => []);
      for (const [name, expected] of snapshot.iconFiles) {
        const actual = await readFile(join(iconOutputRoot, name), "utf8").catch(
          () => null,
        );
        if (actual !== expected) drifted.push(`public/library-icons/${name}`);
      }
      for (const name of actualNames) {
        if (!snapshot.iconFiles.has(name))
          drifted.push(`public/library-icons/${name}`);
      }
    }
    if (drifted.length > 0) {
      throw new Error(
        `Evidence Library contract drift detected: ${drifted.join(", ")}`,
      );
    }
    return { changed: false };
  }

  for (const [relativePath, contents] of files) {
    const destination = join(outputRoot, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents, "utf8");
  }

  if (snapshot.iconFiles.size > 0) {
    if (!iconOutputRoot) throw new Error("Icon output root is required");
    await mkdir(iconOutputRoot, { recursive: true });
    for (const name of await readdir(iconOutputRoot)) {
      if (!snapshot.iconFiles.has(name)) await rm(join(iconOutputRoot, name));
    }
    for (const [name, contents] of snapshot.iconFiles) {
      await writeFile(join(iconOutputRoot, name), contents, "utf8");
    }
  }

  return { changed: true };
}
