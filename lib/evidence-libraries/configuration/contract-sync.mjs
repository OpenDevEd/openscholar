import { createHash } from "node:crypto";

const EXACT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
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
        schema: { sha256: schemaDigest },
        catalogs: { sha256: catalogDigest },
      },
    },
    schemaText,
    catalogText,
  };
}
