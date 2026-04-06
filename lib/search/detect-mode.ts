/**
 * Multilingual question detection for search mode auto-switching.
 *
 * Pure function: (query, locale) => "search" | "research"
 *
 * Detection priority:
 *  1. Question punctuation at end (universal, no length gate)
 *  2. Sentence-final particles (Japanese ka, Chinese ma/ne)
 *  3. Leading question words (locale-scoped, requires 3+ tokens)
 *  4. Relational bridge phrases (academic PICO-style implicit questions, 3+ tokens)
 */

import type { SearchMode } from "@/components/home/ModeToggle";

// ── Question punctuation (universal) ──────────────────────────────────────────

const QUESTION_PUNCTUATION = new Set([
  "?",   // Latin (U+003F)
  "\uFF1F", // CJK fullwidth (U+FF1F)
  "\u061F", // Arabic/Farsi/Urdu (U+061F)
]);

// ── Sentence-final particles (end-of-query) ───────────────────────────────────

const END_PARTICLES = new Set([
  "\u304B", // Japanese か (ka)
  "\u5417", // Chinese 吗 (ma)
  "\u5462", // Chinese 呢 (ne)
]);

// ── Question words by language ────────────────────────────────────────────────

const QUESTION_WORDS: Record<string, readonly string[]> = {
  en: [
    "what", "how", "why", "which", "when", "where", "who", "whom", "whose",
    "does", "do", "did", "is", "are", "was", "were",
    "can", "could", "should", "would", "will", "shall",
    "has", "have", "had",
  ],
  fr: [
    "comment", "pourquoi", "quand", "qui", "quel", "quelle", "quels", "quelles",
    "combien",
  ],
  zh: [
    "\u4EC0\u4E48",       // 什么
    "\u5982\u4F55",       // 如何
    "\u600E\u4E48",       // 怎么
    "\u4E3A\u4EC0\u4E48", // 为什么
    "\u4F55\u65F6",       // 何时
    "\u54EA\u91CC",       // 哪里
    "\u54EA\u513F",       // 哪儿
    "\u8C01",             // 谁
    "\u591A\u5C11",       // 多少
  ],
  hi: [
    "\u0915\u094D\u092F\u093E",     // क्या
    "\u0915\u0948\u0938\u0947",     // कैसे
    "\u0915\u094D\u092F\u094B\u0902", // क्यों
    "\u0915\u092C",                  // कब
    "\u0915\u0939\u093E\u0901",     // कहाँ
    "\u0915\u094C\u0928",           // कौन
    "\u0915\u093F\u0924\u0928\u093E", // कितना
  ],
  ja: [
    "\u306A\u305C", // なぜ
    "\u3069\u3046", // どう
    "\u3044\u3064", // いつ
    "\u3069\u3053", // どこ
    "\u8AB0",       // 誰
    "\u4F55",       // 何
  ],
};

// Multi-word question starters checked separately (must match first N tokens)
const MULTI_WORD_STARTERS: Record<string, readonly string[]> = {
  fr: [
    "est-ce que",
    "qu'est-ce que",
    "qu'est-ce qui",
  ],
};

// ── Relational bridge phrases (language-agnostic academic patterns) ────────────

const BRIDGE_PHRASES_EN = [
  "effect of",
  "effects of",
  "impact of",
  "influence of",
  "role of",
  "relationship between",
  "association between",
  "correlation between",
  "comparison of",
  "difference between",
  "differences between",
] as const;

const BRIDGE_PHRASES_FR = [
  "effet de",
  "effets de",
  "impact de",
  "influence de",
  "r\u00F4le de",       // rôle de
  "relation entre",
  "association entre",
  "corr\u00E9lation entre", // corrélation entre
  "comparaison de",
  "diff\u00E9rence entre",  // différence entre
] as const;

const BRIDGE_PHRASES: Record<string, readonly string[]> = {
  en: BRIDGE_PHRASES_EN,
  fr: BRIDGE_PHRASES_FR,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function tokenCount(s: string): number {
  // CJK/Devanagari: treat each character cluster as a token for length gating.
  // For Latin scripts, split on whitespace.
  const cjkOrDevanagari = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\u0900-\u097F]/;
  if (cjkOrDevanagari.test(s)) {
    // For CJK/Devanagari, character count is a better proxy than whitespace splits.
    // 6 characters ≈ 3 "tokens" equivalent for the length gate.
    return Math.ceil(s.replace(/\s/g, "").length / 2);
  }
  return s.split(/\s+/).filter(Boolean).length;
}

function langFromLocale(locale: string): string {
  return locale.split("-")[0] ?? "en";
}

// ── Main detection function ───────────────────────────────────────────────────

/**
 * Detect whether a query looks like a research question or a keyword search.
 *
 * Designed to run on every keystroke — O(1) lookups, no regex, no allocations
 * beyond the initial trim/lowercase.
 */
export function detectSearchMode(query: string, locale: string): SearchMode {
  const trimmed = query.trim();
  if (!trimmed) return "search";

  const lastChar = trimmed[trimmed.length - 1]!;

  // Priority 1: Question punctuation — universal, no length gate
  if (QUESTION_PUNCTUATION.has(lastChar)) return "research";

  // Priority 2: Sentence-final particles (Japanese か, Chinese 吗/呢)
  if (END_PARTICLES.has(lastChar)) return "research";

  // Everything below requires 3+ tokens to avoid false positives (e.g. "WHO")
  const tokens = tokenCount(trimmed);
  if (tokens < 3) return "search";

  const lower = trimmed.toLowerCase();
  const lang = langFromLocale(locale);

  // Priority 3a: Multi-word question starters (e.g. "est-ce que")
  const multiWord = MULTI_WORD_STARTERS[lang];
  if (multiWord) {
    for (const starter of multiWord) {
      if (lower.startsWith(starter)) return "research";
    }
  }

  // Priority 3b: Single-word question starters
  // Extract first token for Latin scripts, first few chars for CJK/Devanagari
  const words = QUESTION_WORDS[lang];
  if (words) {
    const firstToken = lower.split(/\s+/)[0] ?? "";
    for (const w of words) {
      // For short CJK words, use startsWith on the full string
      if (w.length <= 3 && lower.startsWith(w)) return "research";
      // For Latin/longer words, match the first token exactly
      if (firstToken === w) return "research";
    }
  }

  // Priority 4: Relational bridge phrases (academic implicit questions)
  const bridges = BRIDGE_PHRASES[lang];
  if (bridges) {
    for (const phrase of bridges) {
      if (lower.startsWith(phrase)) return "research";
    }
  }

  return "search";
}
