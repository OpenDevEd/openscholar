import type { CitationStatusMix, DisagreementCluster } from "./insights";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

/** Maps normalized answer keys to their canonical synonym group key. */
export type SynonymMap = Map<string, string>;

export interface GroupedAnswer {
  /** Display string of the most frequent variant in this group. */
  groupRepresentative: string;
  /** Canonical group key (synonym map resolution, e.g. "yes", "n/a"). */
  groupNormalized: string;
  /** Sum of all variant counts. */
  count: number;
  /** Aggregated citationStatusMix across all variants. */
  citationStatusMix: CitationStatusMix;
  variants: Array<{
    display: string;
    normalized: string;
    count: number;
    citationStatusMix: CitationStatusMix;
  }>;
}

/**
 * Input type for groupAnswersBySynonym. Accepts AnswerBucket-like objects
 * with an optional citationStatusMix field (the backend query adds it but it
 * is absent from the AnswerBucket type definition, so we accept it optionally
 * here to avoid a type cast at the call site).
 */
interface AnswerBucketInput {
  normalized: string;
  display: string;
  count: number;
  citationStatusMix?: CitationStatusMix;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

const EMPTY_MIX: CitationStatusMix = {
  grounded: 0,
  best_effort: 0,
  insufficient_evidence: 0,
  extraction_error: 0,
};

function emptyMix(): CitationStatusMix {
  return { ...EMPTY_MIX };
}

function addMix(acc: CitationStatusMix, src: CitationStatusMix): void {
  acc.grounded += src.grounded;
  acc.best_effort += src.best_effort;
  acc.insufficient_evidence += src.insufficient_evidence;
  acc.extraction_error += src.extraction_error;
}

// ────────────────────────────────────────────────────────────
// buildSynonymMap
// ────────────────────────────────────────────────────────────

/**
 * Returns a static synonym map where each synonym maps to its canonical group
 * key.
 *
 * Groups:
 * - Boolean YES: yes, true, positive, affirmative  → "yes"
 * - Boolean NO:  no, false, negative, incorrect    → "no"
 * - Null/missing: n/a, na, not applicable, unknown, none, no data,
 *                 not available, —                 → "n/a"
 *
 * Keys not present in the map self-map (groupKey === normalized).
 */
export function buildSynonymMap(): SynonymMap {
  const map: SynonymMap = new Map();

  const yesGroup = ["yes", "true", "positive", "affirmative"];
  const noGroup = ["no", "false", "negative", "incorrect"];
  const naGroup = ["n/a", "na", "not applicable", "unknown", "none", "no data", "not available", "—"];

  for (const key of yesGroup) map.set(key, "yes");
  for (const key of noGroup) map.set(key, "no");
  for (const key of naGroup) map.set(key, "n/a");

  return map;
}

// ────────────────────────────────────────────────────────────
// groupAnswersBySynonym
// ────────────────────────────────────────────────────────────

/**
 * Groups AnswerBucket-like items by synonym map resolution.
 *
 * - Uses the NORMALIZED key for grouping (per CONTEXT.md locked decision)
 * - Representative = variant with highest count (ties: first encountered)
 * - Group count = sum of all variant counts
 * - Group citationStatusMix = sum of variant citationStatusMix values per key
 * - Missing citationStatusMix defaults to all-zero
 * - Output sorted by group count descending; variants within group sorted desc
 *
 * Intended for rawAnswerDistribution (scalar answers) only — NOT entityDistribution.
 */
export function groupAnswersBySynonym(
  answers: AnswerBucketInput[],
  synonymMap: SynonymMap
): GroupedAnswer[] {
  if (answers.length === 0) return [];

  // Map: groupKey → accumulated group data
  const groups = new Map<
    string,
    {
      variants: Array<{
        display: string;
        normalized: string;
        count: number;
        citationStatusMix: CitationStatusMix;
      }>;
      totalCount: number;
      citationStatusMix: CitationStatusMix;
    }
  >();

  for (const answer of answers) {
    const groupKey = synonymMap.get(answer.normalized) ?? answer.normalized;
    const mix = answer.citationStatusMix ?? emptyMix();

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        variants: [],
        totalCount: 0,
        citationStatusMix: emptyMix(),
      });
    }

    const group = groups.get(groupKey)!;
    group.variants.push({
      display: answer.display,
      normalized: answer.normalized,
      count: answer.count,
      citationStatusMix: { ...mix },
    });
    group.totalCount += answer.count;
    addMix(group.citationStatusMix, mix);
  }

  const result: GroupedAnswer[] = [];

  for (const [groupKey, group] of groups) {
    // Sort variants by count descending (ties: preserve insertion order)
    const sortedVariants = [...group.variants].sort((a, b) => b.count - a.count);

    // Representative = highest-count variant
    const representative = sortedVariants[0];

    result.push({
      groupRepresentative: representative.display,
      groupNormalized: groupKey,
      count: group.totalCount,
      citationStatusMix: group.citationStatusMix,
      variants: sortedVariants,
    });
  }

  // Sort groups by total count descending
  result.sort((a, b) => b.count - a.count);

  return result;
}

// ────────────────────────────────────────────────────────────
// mergeDisagreementClusters
// ────────────────────────────────────────────────────────────

/**
 * Merges DisagreementClusters that share the same synonym group into one
 * combined cluster.
 *
 * - Single cluster per group: returned as-is
 * - Multiple clusters merged: normalizedAnswer = groupKey, displayAnswer from
 *   highest-count cluster
 * - Merged count = sum of cluster counts
 * - Merged avgConfidence = weighted average by count
 * - Merged citationStatusMix = sum per key
 * - Merged examples = concatenated from all clusters (all examples, not just 5)
 * - Output sorted by count descending
 */
export function mergeDisagreementClusters(
  clusters: DisagreementCluster[],
  synonymMap: SynonymMap
): DisagreementCluster[] {
  if (clusters.length === 0) return [];

  // Map: groupKey → list of clusters that fall into this group
  const groups = new Map<string, DisagreementCluster[]>();

  for (const cluster of clusters) {
    const groupKey = synonymMap.get(cluster.normalizedAnswer) ?? cluster.normalizedAnswer;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(cluster);
  }

  const result: DisagreementCluster[] = [];

  for (const [groupKey, groupClusters] of groups) {
    if (groupClusters.length === 1) {
      result.push(groupClusters[0]);
      continue;
    }

    // Multiple clusters → merge
    // Sort by count descending to find representative (highest count)
    const sorted = [...groupClusters].sort((a, b) => b.count - a.count);
    const representative = sorted[0];

    let totalCount = 0;
    let weightedConfidenceSum = 0;
    const mergedMix = emptyMix();
    const allExamples: DisagreementCluster["examples"] = [];

    for (const cluster of groupClusters) {
      totalCount += cluster.count;
      weightedConfidenceSum += cluster.avgConfidence * cluster.count;
      addMix(mergedMix, cluster.citationStatusMix);
      allExamples.push(...cluster.examples);
    }

    result.push({
      normalizedAnswer: groupKey,
      displayAnswer: representative.displayAnswer,
      count: totalCount,
      avgConfidence: totalCount > 0 ? weightedConfidenceSum / totalCount : 0,
      citationStatusMix: mergedMix,
      examples: allExamples,
    });
  }

  // Sort by count descending
  result.sort((a, b) => b.count - a.count);

  return result;
}
