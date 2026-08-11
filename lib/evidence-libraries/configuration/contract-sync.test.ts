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
});
