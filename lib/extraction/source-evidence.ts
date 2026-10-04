import { chunkEvidenceText } from "../../convex/extraction/evidence_units";
import { digestOpaqueToken as sha256 } from "../../convex/lib/opaqueTokenDigest";

type CitationFields = {
  evidenceId: string;
  charRange: [number, number];
  quote: string;
  retrieval: { denseScore?: number; lexicalScore?: number; fusedScore?: number; rerankScore?: number };
  validated: true;
};

// The optional PDF source fields are removed after retained citations are migrated.
export type SourceCitation = CitationFields & (
  | { source?: "pdf"; page: number; paperId?: string; sourceHash?: string }
  | { source: "abstract"; page?: never; paperId: string; sourceHash: string }
);

export const normalizedAbstract = (text: string) => text.replace(/\s+/g, " ").trim();

export async function abstractEvidence(paperId: string, abstract: string) {
  const text = normalizedAbstract(abstract);
  const sourceHash = await sha256(text);
  // At most 200 passages, including unusually long saved abstracts, without truncation.
  const targetChars = Math.max(650, Math.ceil(text.length / 100));
  const units = chunkEvidenceText(text, { targetChars, maxChars: Math.max(900, targetChars), overlapChars: 0 }).map(unit => ({
    ...unit,
    evidenceId: `abstract:${paperId}:${sourceHash}:${unit.charRange[0]}:${unit.charRange[1]}`,
    source: "abstract" as const,
    paperId,
    sourceHash,
  }));
  return { text, sourceHash, units };
}

/** Verify against this saved abstract, never a fresh upstream record. */
export async function validatedAbstractCitations(paperId: string, abstract: string, citations: SourceCitation[]): Promise<SourceCitation[]> {
  if (!citations.some(citation => citation.source === "abstract")) return [];
  const { units } = await abstractEvidence(paperId, abstract);
  const byId = new Map(units.map(unit => [unit.evidenceId, unit]));
  return citations.flatMap(citation => {
    if (citation.source !== "abstract" || !citation.validated || citation.paperId !== paperId) return [];
    const unit = byId.get(citation.evidenceId);
    if (!unit || citation.sourceHash !== unit.sourceHash || citation.quote !== unit.text || citation.charRange.length !== 2 || citation.charRange[0] !== unit.charRange[0] || citation.charRange[1] !== unit.charRange[1]) return [];
    return [{ ...citation, charRange: unit.charRange }];
  });
}

export const pdfEvidenceHash = (unit: { page: number; charRange: number[]; text: string }) => sha256(JSON.stringify([unit.page, unit.charRange, unit.text]));
