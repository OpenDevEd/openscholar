import { describe, expect, test } from "vitest";

import { createContractSnapshot } from "./contract-sync.mjs";

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
});
