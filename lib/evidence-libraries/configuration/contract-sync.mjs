import { createHash } from "node:crypto";

const EXACT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function createContractSnapshot({ repository, commit, schemaText, catalogText }) {
  if (typeof repository !== "string" || repository.trim() === "") {
    throw new Error("Evidence Library repository provenance is required");
  }

  if (!EXACT_COMMIT_PATTERN.test(commit)) {
    throw new Error("Evidence Library revision must be an exact 40-character commit SHA");
  }

  const schema = JSON.parse(schemaText);
  const catalog = JSON.parse(catalogText);

  return {
    lock: {
      formatVersion: 1,
      source: { repository, commit },
      contract: {
        schemaVersion: catalog.schemaVersion,
        catalogVersion: catalog.catalogVersion,
        jsonSchemaDraft: schema.$schema,
      },
      artifacts: {
        schema: { sha256: sha256(schemaText) },
        catalogs: { sha256: sha256(catalogText) },
      },
    },
    schemaText,
    catalogText,
  };
}
