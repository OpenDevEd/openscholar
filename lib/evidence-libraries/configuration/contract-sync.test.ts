import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  createContractSnapshot,
  synchronizeContractSnapshot,
} from "./contract-sync.mjs";

const schemaText = `${JSON.stringify({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  properties: { schemaVersion: { const: 1 } },
})}\n`;

const catalogText = `${JSON.stringify({
  schemaVersion: 1,
  catalogVersion: 1,
  fields: { writeOnlyPaths: [] },
})}\n`;

describe("createContractSnapshot", () => {
  test("rejects a moving branch name", () => {
    expect(() =>
      createContractSnapshot({
        repository: "https://github.com/OpenDevEd/new-el",
        commit: "openscholar",
        schemaText,
        catalogText,
      }),
    ).toThrow(/40-character commit SHA/i);
  });

  test("rejects missing repository provenance", () => {
    expect(() =>
      createContractSnapshot({
        repository: "",
        commit: "4a07fd6176d827d3382b392f847639167ec741ed",
        schemaText,
        catalogText,
      }),
    ).toThrow(/repository provenance/i);
  });

  test("rejects a source artifact whose expected digest does not match", () => {
    expect(() =>
      createContractSnapshot({
        repository: "https://github.com/OpenDevEd/new-el",
        commit: "4a07fd6176d827d3382b392f847639167ec741ed",
        schemaText,
        catalogText,
        expectedDigests: {
          schema: "0".repeat(64),
        },
      }),
    ).toThrow(/schema digest mismatch/i);
  });

  test("rejects artifacts whose declared schema versions disagree", () => {
    const mismatchedCatalogText = `${JSON.stringify({
      schemaVersion: 2,
      catalogVersion: 1,
      fields: { writeOnlyPaths: [] },
    })}\n`;

    expect(() =>
      createContractSnapshot({
        repository: "https://github.com/OpenDevEd/new-el",
        commit: "4a07fd6176d827d3382b392f847639167ec741ed",
        schemaText,
        catalogText: mismatchedCatalogText,
      }),
    ).toThrow(/schema version mismatch/i);
  });

  test("rejects a schema that is not JSON Schema draft 2020-12", () => {
    const draftSevenSchemaText = `${JSON.stringify({
      $schema: "http://json-schema.org/draft-07/schema#",
      properties: { schemaVersion: { const: 1 } },
    })}\n`;

    expect(() =>
      createContractSnapshot({
        repository: "https://github.com/OpenDevEd/new-el",
        commit: "4a07fd6176d827d3382b392f847639167ec741ed",
        schemaText: draftSevenSchemaText,
        catalogText,
      }),
    ).toThrow(/draft 2020-12/i);
  });
});

test("writes exact artifact bytes and verifies them without rewriting", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "openscholar-library-contract-"));
  const snapshot = createContractSnapshot({
    repository: "https://github.com/OpenDevEd/new-el",
    commit: "4a07fd6176d827d3382b392f847639167ec741ed",
    schemaText,
    catalogText,
  });

  try {
    await synchronizeContractSnapshot({
      snapshot,
      outputRoot,
      inspectedCheckoutCommit: "426b4b1a71ed2d5ce045479c1e630c0fc1f3e290",
      check: false,
    });

    await expect(
      readFile(join(outputRoot, "generated/library-config.schema.json"), "utf8"),
    ).resolves.toBe(schemaText);
    await expect(
      readFile(join(outputRoot, "generated/library-config.catalogs.json"), "utf8"),
    ).resolves.toBe(catalogText);
    await expect(
      synchronizeContractSnapshot({
        snapshot,
        outputRoot,
        inspectedCheckoutCommit: "426b4b1a71ed2d5ce045479c1e630c0fc1f3e290",
        check: true,
      }),
    ).resolves.toEqual({ changed: false });
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
