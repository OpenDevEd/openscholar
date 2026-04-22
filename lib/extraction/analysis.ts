export type CitationStatus =
  | "grounded"
  | "best_effort"
  | "insufficient_evidence"
  | "extraction_error";

export type ExtractionAnswer = string | boolean | number | string[] | null | undefined;

export type QuestionType = "string" | "boolean" | "number" | "array";

export type InsightMode = "scalar" | "array";

export type InsightEntry = {
  paperId: string;
  title: string;
  openalexId: string;
  questionKey: string;
  answer: ExtractionAnswer;
  confidence?: number;
  citationStatus?: CitationStatus;
  pdfContentUsed?: boolean;
};

export type AnswerBucket = {
  normalized: string;
  display: string;
  count: number;
  avgConfidence: number;
  paperIds: string[];
};

export type EntityDistributionBucket = {
  entity: string;
  count: number;
  paperIds: string[];
  avgConfidence: number;
  groundedRate: number;
  generic: boolean;
};

export type ConfidenceBuckets = {
  high: number;
  medium: number;
  low: number;
  unknown: number;
};

export type CitationStatusMix = {
  grounded: number;
  best_effort: number;
  insufficient_evidence: number;
  extraction_error: number;
};

export type QuestionInsightAggregate = {
  total: number;
  answered: number;
  grounded: number;
  avgConfidence: number;
  avgEffectiveConfidence: number;
  confidenceBuckets: ConfidenceBuckets;
  citationStatusMix: CitationStatusMix;
  topAnswers: AnswerBucket[];
  entityDistribution: EntityDistributionBucket[];
  insightMode: InsightMode;
};

export type DisagreementCluster = {
  normalizedAnswer: string;
  displayAnswer: string;
  count: number;
  avgConfidence: number;
  citationStatusMix: CitationStatusMix;
  examples: Array<{
    paperId: string;
    title: string;
    openalexId: string;
    answer: ExtractionAnswer;
    confidence?: number;
  }>;
};

export type ArrayProfileClusterResult = {
  clusters: DisagreementCluster[];
  suppressedSingletonCount: number;
  totalClusterCount: number;
};

export type RunDiffRecord = {
  key: string;
  openalexId: string;
  title: string;
  questionKey: string;
  answer: ExtractionAnswer;
  confidence?: number;
  citationStatus?: CitationStatus;
};

export type RunDiffSummary = {
  newAnswers: number;
  changedAnswers: number;
  removedAnswers: number;
  confidenceShifts: number;
  newlyInsufficientEvidence: number;
  totalCompared: number;
};

export type RunDiffChange = {
  openalexId: string;
  title: string;
  questionKey: string;
  changeType:
    | "new"
    | "changed"
    | "removed"
    | "confidence_shift"
    | "newly_insufficient_evidence";
  previousAnswer?: ExtractionAnswer;
  nextAnswer?: ExtractionAnswer;
  previousConfidence?: number;
  nextConfidence?: number;
};

const EMPTY_CONFIDENCE_BUCKETS: ConfidenceBuckets = {
  high: 0,
  medium: 0,
  low: 0,
  unknown: 0,
};

const EMPTY_STATUS_MIX: CitationStatusMix = {
  grounded: 0,
  best_effort: 0,
  insufficient_evidence: 0,
  extraction_error: 0,
};

const EFFECTIVE_CONFIDENCE_MULTIPLIER: Record<CitationStatus, number> = {
  grounded: 1,
  best_effort: 0.55,
  insufficient_evidence: 0,
  extraction_error: 0,
};

const GENERIC_ARRAY_ENTITY_STOPLIST = new Set([
  "artificial intelligence",
  "artificial-intelligence",
  "ai",
  "generative ai",
  "large language model",
  "large language models",
  "llm",
  "llms",
  "language model",
  "language models",
  "machine learning",
  "deep learning",
  "neural network",
  "neural networks",
  "transformer",
  "transformer architecture",
  "transformer architectures",
  "transformer-based models",
]);

export function normalizeArrayEntity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s%.-]/g, "");
}

/** @deprecated kept as alias — use `normalizeArrayEntity`. */
const normalizeText = normalizeArrayEntity;

export function splitArrayFragments(value: string): string[] {
  return value
    .split(/[;,]/g)
    .map((part) => normalizeArrayEntity(part))
    .filter(Boolean);
}

function normalizeArray(values: string[]): string {
  return values.map((v) => normalizeText(v)).filter(Boolean).sort().join(" | ");
}

export function isGenericArrayEntity(entity: string): boolean {
  const normalized = normalizeText(entity);
  if (!normalized) return true;
  if (GENERIC_ARRAY_ENTITY_STOPLIST.has(normalized)) return true;
  if (normalized.includes("machine learning")) return true;
  if (normalized.includes("deep learning")) return true;
  if (normalized.includes("neural network")) return true;
  if (normalized.includes("transformer architecture")) return true;
  return false;
}

export function parseAnswerEntities(answer: ExtractionAnswer): string[] {
  if (answer === null || answer === undefined) return [];

  const normalized = new Set<string>();
  const pushFragments = (raw: string) => {
    for (const fragment of splitArrayFragments(raw)) {
      normalized.add(fragment);
    }
  };

  if (Array.isArray(answer)) {
    for (const item of answer) {
      pushFragments(String(item));
    }
    return Array.from(normalized).sort();
  }

  if (typeof answer === "string") {
    pushFragments(answer);
    return Array.from(normalized).sort();
  }

  return [];
}

export function normalizeAnswer(answer: ExtractionAnswer): string | null {
  if (answer === null || answer === undefined) return null;
  if (typeof answer === "boolean") return answer ? "yes" : "no";
  if (typeof answer === "number") return String(Number(answer));
  if (Array.isArray(answer)) {
    const entities = parseAnswerEntities(answer);
    const normalized = normalizeArray(entities);
    return normalized || null;
  }
  const normalized = normalizeText(String(answer));
  return normalized || null;
}

export function formatAnswerForDisplay(
  answer: ExtractionAnswer,
  type?: QuestionType
): string {
  if (answer === null || answer === undefined) return "Unknown";
  if (type === "boolean" || typeof answer === "boolean") return answer ? "Yes" : "No";
  if (Array.isArray(answer)) return answer.join("; ");
  return String(answer);
}

function getConfidenceBucket(confidence?: number): keyof ConfidenceBuckets {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return "unknown";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

function addCitationStatus(
  mix: CitationStatusMix,
  status?: CitationStatus
): void {
  if (!status) return;
  if (status in mix) {
    mix[status as keyof CitationStatusMix] += 1;
  }
}

function confidenceMultiplier(status?: CitationStatus): number {
  if (!status) return EFFECTIVE_CONFIDENCE_MULTIPLIER.grounded;
  return EFFECTIVE_CONFIDENCE_MULTIPLIER[status] ?? EFFECTIVE_CONFIDENCE_MULTIPLIER.grounded;
}

export function getEffectiveConfidence(
  confidence?: number,
  status?: CitationStatus
): number {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return 0;
  return confidence * confidenceMultiplier(status);
}

export function aggregateQuestionInsights(
  entries: InsightEntry[],
  questionType?: QuestionType
): QuestionInsightAggregate {
  const answerMap = new Map<
    string,
    { display: string; count: number; confidenceSum: number; paperIds: Set<string> }
  >();
  const entityMap = new Map<
    string,
    {
      count: number;
      confidenceSum: number;
      groundedCount: number;
      paperIds: Set<string>;
      generic: boolean;
    }
  >();
  const confidenceBuckets: ConfidenceBuckets = { ...EMPTY_CONFIDENCE_BUCKETS };
  const citationStatusMix: CitationStatusMix = { ...EMPTY_STATUS_MIX };

  let answered = 0;
  let grounded = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;
  let effectiveConfidenceSum = 0;

  for (const entry of entries) {
    const normalized = normalizeAnswer(entry.answer);
    if (normalized !== null) {
      answered += 1;
      const existing = answerMap.get(normalized) || {
        display: formatAnswerForDisplay(entry.answer, questionType),
        count: 0,
        confidenceSum: 0,
        paperIds: new Set<string>(),
      };
      existing.count += 1;
      existing.paperIds.add(entry.paperId);
      if (typeof entry.confidence === "number" && Number.isFinite(entry.confidence)) {
        existing.confidenceSum += entry.confidence;
      }
      answerMap.set(normalized, existing);
    }

    if (questionType === "array") {
      const entities = parseAnswerEntities(entry.answer);
      for (const entity of entities) {
        const existingEntity = entityMap.get(entity) || {
          count: 0,
          confidenceSum: 0,
          groundedCount: 0,
          paperIds: new Set<string>(),
          generic: isGenericArrayEntity(entity),
        };
        existingEntity.count += 1;
        existingEntity.paperIds.add(entry.paperId);
        if (entry.citationStatus === "grounded") {
          existingEntity.groundedCount += 1;
        }
        if (typeof entry.confidence === "number" && Number.isFinite(entry.confidence)) {
          existingEntity.confidenceSum += entry.confidence;
        }
        entityMap.set(entity, existingEntity);
      }
    }

    const bucket = getConfidenceBucket(entry.confidence);
    confidenceBuckets[bucket] += 1;

    if (typeof entry.confidence === "number" && Number.isFinite(entry.confidence)) {
      confidenceSum += entry.confidence;
      confidenceCount += 1;
      effectiveConfidenceSum += getEffectiveConfidence(entry.confidence, entry.citationStatus);
    }

    if (entry.citationStatus === "grounded") grounded += 1;
    addCitationStatus(citationStatusMix, entry.citationStatus);
  }

  const topAnswers: AnswerBucket[] = Array.from(answerMap.entries())
    .map(([normalized, value]) => ({
      normalized,
      display: value.display,
      count: value.count,
      avgConfidence: value.count > 0 ? value.confidenceSum / value.count : 0,
      paperIds: Array.from(value.paperIds),
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.avgConfidence - a.avgConfidence;
    })
    .slice(0, 10);

  const entityDistribution: EntityDistributionBucket[] = Array.from(entityMap.entries())
    .map(([entity, value]) => ({
      entity,
      count: value.count,
      paperIds: Array.from(value.paperIds),
      avgConfidence: value.count > 0 ? value.confidenceSum / value.count : 0,
      groundedRate: value.count > 0 ? value.groundedCount / value.count : 0,
      generic: value.generic,
    }))
    .sort((a, b) => {
      if (a.generic !== b.generic) return a.generic ? 1 : -1;
      if (b.count !== a.count) return b.count - a.count;
      if (b.avgConfidence !== a.avgConfidence) return b.avgConfidence - a.avgConfidence;
      return a.entity.localeCompare(b.entity);
    })
    .slice(0, 40);

  return {
    total: entries.length,
    answered,
    grounded,
    avgConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
    avgEffectiveConfidence:
      confidenceCount > 0 ? effectiveConfidenceSum / confidenceCount : 0,
    confidenceBuckets,
    citationStatusMix,
    topAnswers,
    entityDistribution,
    insightMode: questionType === "array" ? "array" : "scalar",
  };
}

export function buildDisagreementClusters(
  entries: InsightEntry[],
  questionType?: QuestionType,
  maxClusters = 20
): DisagreementCluster[] {
  const groups = new Map<string, InsightEntry[]>();

  for (const entry of entries) {
    const normalized = normalizeAnswer(entry.answer);
    if (normalized === null) continue;
    if (!groups.has(normalized)) groups.set(normalized, []);
    groups.get(normalized)!.push(entry);
  }

  if (groups.size <= 1) return [];

  const clusters: DisagreementCluster[] = Array.from(groups.entries())
    .map(([normalizedAnswer, rows]) => {
      const citationStatusMix: CitationStatusMix = { ...EMPTY_STATUS_MIX };
      let confidenceSum = 0;
      let confidenceCount = 0;
      for (const row of rows) {
        addCitationStatus(citationStatusMix, row.citationStatus);
        if (typeof row.confidence === "number" && Number.isFinite(row.confidence)) {
          confidenceSum += row.confidence;
          confidenceCount += 1;
        }
      }
      return {
        normalizedAnswer,
        displayAnswer: formatAnswerForDisplay(rows[0]?.answer, questionType),
        count: rows.length,
        avgConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
        citationStatusMix,
        examples: rows
          .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
          .slice(0, 5)
          .map((row) => ({
            paperId: row.paperId,
            title: row.title,
            openalexId: row.openalexId,
            answer: row.answer,
            confidence: row.confidence,
          })),
      };
    })
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.avgConfidence - a.avgConfidence;
    })
    .slice(0, maxClusters);

  return clusters;
}

export function buildArrayAnswerProfileClusters(
  entries: InsightEntry[],
  options?: {
    minClusterSize?: number;
    maxClusters?: number;
  }
): ArrayProfileClusterResult {
  const minClusterSize = Math.max(1, options?.minClusterSize ?? 2);
  const maxClusters = Math.max(1, options?.maxClusters ?? 20);
  const groups = new Map<string, InsightEntry[]>();

  for (const entry of entries) {
    const entities = parseAnswerEntities(entry.answer);
    if (entities.length === 0) continue;
    const nonGeneric = entities.filter((entity) => !isGenericArrayEntity(entity));
    const selected = (nonGeneric.length > 0 ? nonGeneric : entities).slice(0, 3).sort();
    const signature = selected.join(" | ");
    if (!signature) continue;
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature)!.push(entry);
  }

  const totalClusterCount = groups.size;
  if (totalClusterCount === 0) {
    return {
      clusters: [],
      suppressedSingletonCount: 0,
      totalClusterCount: 0,
    };
  }

  let singletonCount = 0;
  let hasNonSingleton = false;
  for (const rows of groups.values()) {
    if (rows.length < minClusterSize) singletonCount += 1;
    if (rows.length >= minClusterSize) hasNonSingleton = true;
  }

  const selectedGroups = hasNonSingleton
    ? Array.from(groups.entries()).filter(([, rows]) => rows.length >= minClusterSize)
    : Array.from(groups.entries());
  const suppressedSingletonCount = hasNonSingleton ? singletonCount : 0;

  const clusters: DisagreementCluster[] = selectedGroups
    .map(([signature, rows]) => {
      const citationStatusMix: CitationStatusMix = { ...EMPTY_STATUS_MIX };
      let confidenceSum = 0;
      let confidenceCount = 0;
      for (const row of rows) {
        addCitationStatus(citationStatusMix, row.citationStatus);
        if (typeof row.confidence === "number" && Number.isFinite(row.confidence)) {
          confidenceSum += row.confidence;
          confidenceCount += 1;
        }
      }
      return {
        normalizedAnswer: signature,
        displayAnswer: signature.split(" | ").join("; "),
        count: rows.length,
        avgConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
        citationStatusMix,
        examples: rows
          .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
          .slice(0, 5)
          .map((row) => ({
            paperId: row.paperId,
            title: row.title,
            openalexId: row.openalexId,
            answer: row.answer,
            confidence: row.confidence,
          })),
      };
    })
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.avgConfidence - a.avgConfidence;
    })
    .slice(0, maxClusters);

  return {
    clusters,
    suppressedSingletonCount,
    totalClusterCount,
  };
}

function answersEqual(
  left: ExtractionAnswer,
  right: ExtractionAnswer
): boolean {
  return normalizeAnswer(left) === normalizeAnswer(right);
}

export function buildRunDiff(
  baseline: RunDiffRecord[],
  next: RunDiffRecord[],
  confidenceShiftThreshold = 0.2
): { summary: RunDiffSummary; changes: RunDiffChange[] } {
  const baselineByKey = new Map<string, RunDiffRecord>();
  const nextByKey = new Map<string, RunDiffRecord>();

  for (const row of baseline) baselineByKey.set(row.key, row);
  for (const row of next) nextByKey.set(row.key, row);

  const allKeys = new Set([...baselineByKey.keys(), ...nextByKey.keys()]);
  const changes: RunDiffChange[] = [];

  const summary: RunDiffSummary = {
    newAnswers: 0,
    changedAnswers: 0,
    removedAnswers: 0,
    confidenceShifts: 0,
    newlyInsufficientEvidence: 0,
    totalCompared: allKeys.size,
  };

  for (const key of allKeys) {
    const previous = baselineByKey.get(key);
    const current = nextByKey.get(key);
    if (!previous && current) {
      const hasAnswer = normalizeAnswer(current.answer) !== null;
      if (hasAnswer) {
        summary.newAnswers += 1;
        changes.push({
          openalexId: current.openalexId,
          title: current.title,
          questionKey: current.questionKey,
          changeType: "new",
          previousAnswer: null,
          nextAnswer: current.answer,
          previousConfidence: undefined,
          nextConfidence: current.confidence,
        });
      }
      continue;
    }

    if (previous && !current) {
      const hadAnswer = normalizeAnswer(previous.answer) !== null;
      if (hadAnswer) {
        summary.removedAnswers += 1;
        changes.push({
          openalexId: previous.openalexId,
          title: previous.title,
          questionKey: previous.questionKey,
          changeType: "removed",
          previousAnswer: previous.answer,
          nextAnswer: null,
          previousConfidence: previous.confidence,
          nextConfidence: undefined,
        });
      }
      continue;
    }

    if (!previous || !current) continue;

    const previousAnswer = previous.answer;
    const nextAnswer = current.answer;
    const hadAnswer = normalizeAnswer(previousAnswer) !== null;
    const hasAnswer = normalizeAnswer(nextAnswer) !== null;

    if (!hadAnswer && hasAnswer) {
      summary.newAnswers += 1;
      changes.push({
        openalexId: current.openalexId,
        title: current.title,
        questionKey: current.questionKey,
        changeType: "new",
        previousAnswer,
        nextAnswer,
        previousConfidence: previous.confidence,
        nextConfidence: current.confidence,
      });
    } else if (hadAnswer && !hasAnswer) {
      summary.removedAnswers += 1;
      changes.push({
        openalexId: current.openalexId,
        title: current.title,
        questionKey: current.questionKey,
        changeType: "removed",
        previousAnswer,
        nextAnswer,
        previousConfidence: previous.confidence,
        nextConfidence: current.confidence,
      });
    } else if (hadAnswer && hasAnswer && !answersEqual(previousAnswer, nextAnswer)) {
      summary.changedAnswers += 1;
      changes.push({
        openalexId: current.openalexId,
        title: current.title,
        questionKey: current.questionKey,
        changeType: "changed",
        previousAnswer,
        nextAnswer,
        previousConfidence: previous.confidence,
        nextConfidence: current.confidence,
      });
    }

    if (
      typeof previous.confidence === "number" &&
      typeof current.confidence === "number" &&
      Math.abs(current.confidence - previous.confidence) >= confidenceShiftThreshold
    ) {
      summary.confidenceShifts += 1;
      changes.push({
        openalexId: current.openalexId,
        title: current.title,
        questionKey: current.questionKey,
        changeType: "confidence_shift",
        previousAnswer,
        nextAnswer,
        previousConfidence: previous.confidence,
        nextConfidence: current.confidence,
      });
    }

    if (
      previous.citationStatus !== "insufficient_evidence" &&
      current.citationStatus === "insufficient_evidence"
    ) {
      summary.newlyInsufficientEvidence += 1;
      changes.push({
        openalexId: current.openalexId,
        title: current.title,
        questionKey: current.questionKey,
        changeType: "newly_insufficient_evidence",
        previousAnswer,
        nextAnswer,
        previousConfidence: previous.confidence,
        nextConfidence: current.confidence,
      });
    }
  }

  return { summary, changes };
}
