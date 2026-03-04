"use node";

export type PdfPageAnchorSource = {
  pageNumber: number;
  text: string;
};

export type PdfChunkPageSource = {
  pageNumber: number;
  text: string;
  section?: string;
};

export type EvidenceTextBlock = {
  section: string;
  text: string;
};

export type AnchoredEvidenceUnit = {
  evidenceId: string;
  page: number;
  charRange: [number, number];
  text: string;
  section?: string;
  tokens: string[];
  anchorConfidence: number;
  source: "pdfjs_fallback" | "pdfjs_chunks";
};

export type RankedEvidenceScore = {
  evidenceId: string;
  score: number;
};

export type FusedEvidenceScore = {
  evidenceId: string;
  denseScore?: number;
  lexicalScore?: number;
  fusedScore: number;
  denseRank?: number;
  lexicalRank?: number;
};

const DEFAULT_TARGET_CHARS = 650;
const DEFAULT_MAX_CHARS = 900;
const DEFAULT_OVERLAP_CHARS = 120;

const MIN_UNIT_LEN = 120;
const MAX_UNIT_LEN = 360;

function hashText(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeSpace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "were",
  "with",
  "what",
  "which",
  "who",
  "where",
  "when",
  "why",
  "how",
  "does",
  "do",
  "did",
  "we",
  "our",
  "you",
  "your",
]);

const QUERY_EXPANSION_RULES: Array<{ pattern: RegExp; terms: string[] }> = [
  {
    pattern: /\b(sample size|how many|number of|count|participants?|n=?)\b/i,
    terms: [
      "sample",
      "size",
      "participants",
      "participant",
      "studies",
      "study",
      "coded",
      "analyzed",
      "analysis",
      "n",
    ],
  },
  {
    pattern: /\b(findings?|results?)\b/i,
    terms: ["findings", "results", "conclusion", "evidence"],
  },
  {
    pattern: /\b(language|written|document language)\b/i,
    terms: ["language", "english", "spanish", "french", "german"],
  },
];

function isNumericToken(token: string) {
  return /^\d+(?:[.,]\d+)?$/.test(token);
}

function normalizeForMatch(text: string): { normalized: string; mapping: number[] } {
  const normalized: string[] = [];
  const mapping: number[] = [];
  let lastWasSpace = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "-" && next === "\n") {
      i += 1;
      continue;
    }
    if (char === "\u00ad") continue;

    const lower = char.toLowerCase();
    const isAlphaNum = /[a-z0-9]/.test(lower);
    if (isAlphaNum) {
      normalized.push(lower);
      mapping.push(i);
      lastWasSpace = false;
      continue;
    }

    if (!lastWasSpace) {
      normalized.push(" ");
      mapping.push(i);
      lastWasSpace = true;
    }
  }

  return { normalized: normalized.join(""), mapping };
}

function splitParagraphToSentences(text: string) {
  const normalized = normalizeSpace(text);
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [normalized];
  return sentences.map((s) => normalizeSpace(s)).filter(Boolean);
}

function buildSentenceUnits(text: string) {
  const sentences = splitParagraphToSentences(text);
  if (sentences.length === 0) return [];

  const units: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length <= MAX_UNIT_LEN) {
      current = next;
      continue;
    }

    if (current.length >= MIN_UNIT_LEN) {
      units.push(current);
      current = sentence;
      continue;
    }

    // Force cap overly long single sentence blocks.
    units.push(next.slice(0, MAX_UNIT_LEN).trim());
    current = "";
  }

  if (current) {
    if (current.length >= MIN_UNIT_LEN) {
      units.push(current);
    } else if (units.length > 0) {
      const merged = `${units[units.length - 1]} ${current}`.slice(0, MAX_UNIT_LEN);
      units[units.length - 1] = normalizeSpace(merged);
    }
  }

  return units.map((unit) => normalizeSpace(unit)).filter((unit) => unit.length >= MIN_UNIT_LEN);
}

export function tokenizeForLexical(
  text: string,
  options?: { keepStopwords?: boolean }
) {
  const keepStopwords = options?.keepStopwords === true;
  return normalizeSpace(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => {
      if (!token) return false;
      if (token === "n") return true;
      if (isNumericToken(token)) return true;
      if (token.length < 2) return false;
      if (!keepStopwords && STOPWORDS.has(token)) return false;
      return true;
    });
}

function findExactOffsets(pageText: string, candidate: string): [number, number] | null {
  const pageNorm = normalizeForMatch(pageText);
  const candidateNorm = normalizeForMatch(candidate).normalized.trim();
  if (!candidateNorm) return null;
  const index = pageNorm.normalized.indexOf(candidateNorm);
  if (index < 0) return null;

  const start = pageNorm.mapping[index];
  const endMapIndex = Math.min(
    index + candidateNorm.length - 1,
    pageNorm.mapping.length - 1
  );
  const end = pageNorm.mapping[endMapIndex] + 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return [start, end];
}

function findFuzzyOffsets(pageText: string, candidate: string): [number, number] | null {
  const pageNorm = normalizeForMatch(pageText);
  const tokens = normalizeForMatch(candidate).normalized
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 2);
  if (tokens.length < 6) return null;

  for (let window = Math.min(9, tokens.length); window >= 5; window--) {
    for (let i = 0; i <= tokens.length - window; i++) {
      const phrase = tokens.slice(i, i + window).join(" ");
      const idx = pageNorm.normalized.indexOf(phrase);
      if (idx < 0) continue;
      const start = pageNorm.mapping[idx];
      const endMapIndex = Math.min(
        idx + phrase.length - 1,
        pageNorm.mapping.length - 1
      );
      const end = pageNorm.mapping[endMapIndex] + 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      return [start, end];
    }
  }

  return null;
}

function anchorCandidate(
  candidate: string,
  pages: PdfPageAnchorSource[]
): { page: number; charRange: [number, number]; confidence: number } | null {
  for (const page of pages) {
    const exact = findExactOffsets(page.text, candidate);
    if (exact) {
      return { page: page.pageNumber, charRange: exact, confidence: 1 };
    }
  }

  for (const page of pages) {
    const fuzzy = findFuzzyOffsets(page.text, candidate);
    if (fuzzy) {
      return { page: page.pageNumber, charRange: fuzzy, confidence: 0.88 };
    }
  }

  return null;
}

export function buildAnchoredEvidenceUnits(
  blocks: EvidenceTextBlock[],
  pages: PdfPageAnchorSource[],
  options?: { source?: AnchoredEvidenceUnit["source"] }
): AnchoredEvidenceUnit[] {
  const units: AnchoredEvidenceUnit[] = [];
  const seenRanges = new Set<string>();
  const source = options?.source || "pdfjs_chunks";

  for (const block of blocks) {
    const candidateSentences = buildSentenceUnits(block.text);
    for (const sentence of candidateSentences) {
      const anchored = anchorCandidate(sentence, pages);
      if (!anchored || anchored.confidence < 0.85) continue;

      const [start, end] = anchored.charRange;
      const rangeKey = `${anchored.page}:${start}:${end}`;
      if (seenRanges.has(rangeKey)) continue;
      seenRanges.add(rangeKey);

      const evidenceId = `ev_${anchored.page}_${start}_${end}_${hashText(sentence).slice(0, 6)}`;
      units.push({
        evidenceId,
        page: anchored.page,
        charRange: [start, end],
        text: sentence,
        section: block.section || "body",
        tokens: tokenizeForLexical(sentence),
        anchorConfidence: anchored.confidence,
        source,
      });
    }
  }

  return units;
}

function isBoundaryChar(char: string | undefined) {
  return char === "." || char === "!" || char === "?" || char === ";" || char === ":" || char === "\n";
}

function skipLeadingWhitespace(text: string, index: number) {
  let cursor = Math.max(0, index);
  while (cursor < text.length && /\s/.test(text[cursor])) {
    cursor++;
  }
  return cursor;
}

function trimRange(text: string, start: number, end: number): [number, number] {
  let nextStart = Math.max(0, start);
  let nextEnd = Math.max(nextStart, end);
  while (nextStart < nextEnd && /\s/.test(text[nextStart])) {
    nextStart++;
  }
  while (nextEnd > nextStart && /\s/.test(text[nextEnd - 1])) {
    nextEnd--;
  }
  return [nextStart, nextEnd];
}

function pickChunkEnd(
  text: string,
  start: number,
  minEnd: number,
  idealEnd: number,
  maxEnd: number
) {
  let bestEnd = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let end = minEnd; end <= maxEnd; end++) {
    const prev = text[end - 1];
    if (!prev) continue;
    if (!isBoundaryChar(prev) && prev !== " ") continue;
    const distance = Math.abs(end - idealEnd);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestEnd = end;
      if (distance === 0) {
        break;
      }
    }
  }

  if (bestEnd > start) {
    return bestEnd;
  }
  return maxEnd;
}

export function buildChunkedEvidenceUnitsFromPdfPages(
  pages: PdfChunkPageSource[],
  options?: {
    targetChars?: number;
    maxChars?: number;
    overlapChars?: number;
    source?: AnchoredEvidenceUnit["source"];
  }
): AnchoredEvidenceUnit[] {
  const targetChars = Math.max(180, options?.targetChars ?? DEFAULT_TARGET_CHARS);
  const maxChars = Math.max(targetChars, options?.maxChars ?? DEFAULT_MAX_CHARS);
  const overlapChars = Math.max(0, Math.min(targetChars - 40, options?.overlapChars ?? DEFAULT_OVERLAP_CHARS));
  const source = options?.source ?? "pdfjs_chunks";

  const units: AnchoredEvidenceUnit[] = [];
  const seenRanges = new Set<string>();

  for (const page of pages) {
    const pageText = page.text || "";
    if (!pageText.trim()) continue;

    let cursor = skipLeadingWhitespace(pageText, 0);
    while (cursor < pageText.length) {
      const idealEnd = Math.min(pageText.length, cursor + targetChars);
      const minEnd = Math.min(pageText.length, cursor + Math.max(140, Math.floor(targetChars * 0.6)));
      const maxEnd = Math.min(pageText.length, cursor + maxChars);
      let rawEnd = pickChunkEnd(pageText, cursor, minEnd, idealEnd, maxEnd);
      if (rawEnd <= cursor) {
        rawEnd = Math.min(pageText.length, cursor + targetChars);
      }

      const [start, end] = trimRange(pageText, cursor, rawEnd);
      if (end <= start) {
        if (rawEnd >= pageText.length) break;
        cursor = skipLeadingWhitespace(pageText, Math.max(rawEnd, cursor + 1));
        continue;
      }

      const rangeKey = `${page.pageNumber}:${start}:${end}`;
      if (!seenRanges.has(rangeKey)) {
        seenRanges.add(rangeKey);
        const text = pageText.slice(start, end);
        const evidenceId = `ev_${page.pageNumber}_${start}_${end}_${hashText(text).slice(0, 6)}`;
        units.push({
          evidenceId,
          page: page.pageNumber,
          charRange: [start, end],
          text,
          section: page.section || "body",
          tokens: tokenizeForLexical(text),
          anchorConfidence: 1,
          source,
        });
      }

      if (end >= pageText.length) break;
      const nextCursor = Math.max(end - overlapChars, cursor + 1);
      cursor = skipLeadingWhitespace(pageText, nextCursor);
    }
  }

  return units;
}

function buildQueryTokenWeights(query: string, baseTokens: string[]) {
  const weights = new Map<string, number>();
  for (const token of baseTokens) {
    weights.set(token, 1);
  }

  for (const rule of QUERY_EXPANSION_RULES) {
    if (!rule.pattern.test(query)) continue;
    for (const token of rule.terms) {
      const normalized = tokenizeForLexical(token, { keepStopwords: false })[0];
      if (!normalized) continue;
      if (!weights.has(normalized)) {
        weights.set(normalized, 0.6);
      }
    }
  }

  return weights;
}

export function scoreLexicalEvidence(
  query: string,
  units: Array<Pick<AnchoredEvidenceUnit, "evidenceId" | "tokens">>,
  limit = 80
): RankedEvidenceScore[] {
  const queryTokens = tokenizeForLexical(query, { keepStopwords: false });
  const queryTokenWeights = buildQueryTokenWeights(query, queryTokens);
  if (queryTokenWeights.size === 0) return [];

  const docFrequency = new Map<string, number>();
  for (const unit of units) {
    for (const token of new Set(unit.tokens)) {
      docFrequency.set(token, (docFrequency.get(token) || 0) + 1);
    }
  }

  const n = Math.max(1, units.length);
  const scores: RankedEvidenceScore[] = [];
  const countIntent = /\b(sample size|how many|number of|count|participants?|n=?\s*\d*)\b/i.test(query);

  for (const unit of units) {
    if (unit.tokens.length === 0) continue;

    const tf = new Map<string, number>();
    for (const token of unit.tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    let score = 0;
    let matchedTokens = 0;
    for (const [token, weight] of queryTokenWeights.entries()) {
      const termFreq = tf.get(token) || 0;
      if (!termFreq) continue;
      matchedTokens++;
      const df = docFrequency.get(token) || 0;
      const idf = Math.log((n + 1) / (df + 1)) + 1;
      score += termFreq * idf * weight;
    }

    if (countIntent) {
      const hasNumericToken = unit.tokens.some((token) => isNumericToken(token));
      if (hasNumericToken) {
        score += 0.75;
      }
      const sampleTokens = ["sample", "size"];
      if (sampleTokens.every((token) => tf.has(token))) {
        score += 0.5;
      }
      const studyTokens = ["studies", "coded"];
      if (studyTokens.every((token) => tf.has(token))) {
        score += 0.5;
      }
    }

    const coverageBonus = queryTokenWeights.size
      ? (matchedTokens / queryTokenWeights.size) * 0.5
      : 0;
    score += coverageBonus;

    if (score <= 0) continue;

    scores.push({
      evidenceId: unit.evidenceId,
      score: score / Math.sqrt(Math.max(unit.tokens.length, 8)),
    });
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function reciprocalRankFuse(
  dense: RankedEvidenceScore[],
  lexical: RankedEvidenceScore[],
  constant = 60
): FusedEvidenceScore[] {
  const fused = new Map<string, FusedEvidenceScore>();

  dense.forEach((item, index) => {
    const current = fused.get(item.evidenceId) || {
      evidenceId: item.evidenceId,
      fusedScore: 0,
    };
    current.denseScore = item.score;
    current.denseRank = index + 1;
    current.fusedScore += 1 / (constant + index + 1);
    fused.set(item.evidenceId, current);
  });

  lexical.forEach((item, index) => {
    const current = fused.get(item.evidenceId) || {
      evidenceId: item.evidenceId,
      fusedScore: 0,
    };
    current.lexicalScore = item.score;
    current.lexicalRank = index + 1;
    current.fusedScore += 1 / (constant + index + 1);
    fused.set(item.evidenceId, current);
  });

  return Array.from(fused.values()).sort((a, b) => b.fusedScore - a.fusedScore);
}
