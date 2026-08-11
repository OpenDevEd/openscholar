import { describe, expect, test } from "vitest";

import lock from "./contract-lock.json";
import {
  EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
  assertCompatibleContract,
} from "./contract";

describe("Evidence Library contract provenance", () => {
  test("exposes the lock as a compatibility boundary", () => {
    expect(EVIDENCE_LIBRARY_CONFIG_PROVENANCE).toEqual({
      repository: lock.source.repository,
      commit: lock.source.commit,
      schemaVersion: lock.contract.schemaVersion,
      catalogVersion: lock.contract.catalogVersion,
      schemaSha256: lock.artifacts.schema.sha256,
      catalogsSha256: lock.artifacts.catalogs.sha256,
    });

    expect(() =>
      assertCompatibleContract(EVIDENCE_LIBRARY_CONFIG_PROVENANCE),
    ).not.toThrow();
    expect(() =>
      assertCompatibleContract({
        ...EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
        schemaVersion: EVIDENCE_LIBRARY_CONFIG_PROVENANCE.schemaVersion + 1,
      }),
    ).toThrow(/schema version mismatch/i);
  });
});
