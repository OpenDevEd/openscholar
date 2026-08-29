import { describe, expect, it } from "vitest";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import {
  projectDraftConfigurationSections,
  projectRevisionConfigurationSections,
} from "./queries";

const storedProvenance = {
  ...EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
  commit: "stored-commit",
};

describe("configuration query projections", () => {
  it("projects migrated draft sections and uses header metadata for new keys", () => {
    const sections = projectDraftConfigurationSections(
      [
        { sectionKey: "identity", payload: { name: "Kept" } },
        { sectionKey: "footer", payload: { poweredBy: true } },
      ],
      [
        {
          kind: "draft",
          sectionKey: "identity",
          contractProvenance: storedProvenance,
          updatedAt: 12,
        },
        {
          kind: "draft",
          sectionKey: "theme",
          contractProvenance: storedProvenance,
          updatedAt: 13,
        },
      ],
      {
        contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
        updatedAt: 99,
      },
    );

    expect(sections).toEqual([
      {
        contractProvenance: storedProvenance,
        payload: { name: "Kept" },
        payloadByteLength: 15,
        sectionKey: "identity",
        updatedAt: 12,
      },
      {
        contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
        payload: { poweredBy: true },
        payloadByteLength: 18,
        sectionKey: "footer",
        updatedAt: 99,
      },
    ]);
  });

  it("projects migrated revision sections and drops removed keys", () => {
    const sections = projectRevisionConfigurationSections(
      [{ sectionKey: "footer", payload: { poweredBy: true } }],
      [
        {
          kind: "revision",
          sectionKey: "theme",
          contractProvenance: storedProvenance,
          createdAt: 12,
        },
      ],
      {
        contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
        createdAt: 99,
      },
    );

    expect(sections).toEqual([
      {
        contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
        createdAt: 99,
        payload: { poweredBy: true },
        payloadByteLength: 18,
        sectionKey: "footer",
      },
    ]);
  });
});
