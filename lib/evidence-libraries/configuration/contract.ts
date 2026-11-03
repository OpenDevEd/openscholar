import lock from "./contract-lock.json";

export type EvidenceLibraryConfigProvenance = {
  repository: string;
  commit: string;
  schemaVersion: number;
  catalogVersion: number;
  schemaSha256: string;
  catalogsSha256: string;
};

export const EVIDENCE_LIBRARY_CONFIG_PROVENANCE = Object.freeze({
  repository: lock.source.repository,
  commit: lock.source.commit,
  schemaVersion: lock.contract.schemaVersion,
  catalogVersion: lock.contract.catalogVersion,
  schemaSha256: lock.artifacts.schema.sha256,
  catalogsSha256: lock.artifacts.catalogs.sha256,
}) satisfies Readonly<EvidenceLibraryConfigProvenance>;

export function assertCompatibleContract(
  candidate: EvidenceLibraryConfigProvenance,
): void {
  if (candidate.repository !== EVIDENCE_LIBRARY_CONFIG_PROVENANCE.repository) {
    throw new Error("Evidence Community contract repository mismatch");
  }
  if (candidate.commit !== EVIDENCE_LIBRARY_CONFIG_PROVENANCE.commit) {
    throw new Error("Evidence Community contract commit mismatch");
  }
  if (
    candidate.schemaVersion !== EVIDENCE_LIBRARY_CONFIG_PROVENANCE.schemaVersion
  ) {
    throw new Error("Evidence Community contract schema version mismatch");
  }
  if (
    candidate.catalogVersion !==
    EVIDENCE_LIBRARY_CONFIG_PROVENANCE.catalogVersion
  ) {
    throw new Error("Evidence Community contract catalog version mismatch");
  }
  if (
    candidate.schemaSha256 !== EVIDENCE_LIBRARY_CONFIG_PROVENANCE.schemaSha256
  ) {
    throw new Error("Evidence Community contract schema digest mismatch");
  }
  if (
    candidate.catalogsSha256 !==
    EVIDENCE_LIBRARY_CONFIG_PROVENANCE.catalogsSha256
  ) {
    throw new Error("Evidence Community contract catalogs digest mismatch");
  }
}
