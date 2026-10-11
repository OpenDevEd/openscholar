import { stemmer } from "stemmer";
import { hasUnquotedWildcard } from "./wildcard";
import { expandShortcuts, shortcutNameOf, type ShortcutExpansions } from "@/lib/query-shortcuts";

/**
 * Reads an OpenAlex boolean search (AND, OR, NOT, parentheses, quoted phrases, `"a b"~N`,
 * `*` and `?` wildcards) into concepts, so the query box and the results colour each one the
 * same way. Terms joined by OR are one concept. Each side of an explicit AND is its own concept.
 * Words side by side with no operator stay one concept. Terms under NOT are excluded. A saved
 * shortcut (`name...`) is one concept, whatever its expansion holds.
 */

type QueryTokenKind = "space" | "open" | "close" | "and" | "or" | "not" | "term" | "phrase";

export interface QueryToken {
  kind: QueryTokenKind;
  text: string;
  /** Parentheses this token sits inside; a parenthesis counts its own group. */
  depth: number;
  /** Concept index for a term or phrase, or for a group whose terms all share one. */
  concept?: number;
  /** A term, phrase or "(" under NOT. */
  excluded?: boolean;
  /** Set on "close": no "(" opened it. Set on "open": nothing closes it. */
  unmatched?: boolean;
}

export interface ParsedQuery {
  tokens: QueryToken[];
  conceptCount: number;
  /** Search terms per concept, excluded terms left out. */
  concepts: string[][];
}

// A phrase is `"a b"`, `"a b"~N` (proximity) or `"a b"~N~"c d"` (two phrases near each other).
const TOKEN = /(\s+)|(\()|(\))|("[^"]*"~\d+~"[^"]*"?|"[^"]*"?(?:~\d+)?)|([^\s()"]+)/g;
const OPERATORS = new Map<string, QueryTokenKind>([
  ["AND", "and"],
  ["OR", "or"],
  ["NOT", "not"],
]);

function tokenize(query: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  let depth = 0;
  for (const [text, space, open, close, phrase] of query.matchAll(TOKEN)) {
    let kind: QueryTokenKind;
    if (space) kind = "space";
    else if (open) kind = "open";
    else if (close) kind = "close";
    else if (phrase) kind = "phrase";
    else kind = OPERATORS.get(text) ?? "term";
    if (kind === "open") depth++;
    tokens.push({ kind, text, depth: Math.max(depth, 0) });
    if (kind === "close") depth--;
  }
  return tokens;
}

type Node =
  | { kind: "leaf"; at: number }
  | { kind: "not"; child: Node }
  | { kind: "group"; open: number; close: number | null; child: Node | null }
  | { kind: "and"; explicit: boolean; children: Node[] }
  | { kind: "or"; children: Node[] };

/** Recursive descent over the non-space tokens: or > and (explicit or side by side) > not > group. */
function parse(tokens: QueryToken[]): Node | null {
  const order = tokens.flatMap((token, at) => (token.kind === "space" ? [] : [at]));
  let i = 0;
  const peek = () => (i < order.length ? tokens[order[i]].kind : null);

  function or(): Node | null {
    const children: Node[] = [];
    const first = and();
    if (first) children.push(first);
    while (peek() === "or") {
      i++;
      const next = and();
      if (next) children.push(next);
    }
    if (children.length === 0) return null;
    return children.length === 1 ? children[0] : { kind: "or", children };
  }

  /** Words side by side stay together as one run; an explicit AND starts the next run. */
  function and(): Node | null {
    const runs: Node[][] = [[]];
    for (;;) {
      const kind = peek();
      if (kind === "and") {
        i++;
        runs.push([]);
        continue;
      }
      if (kind === null || kind === "or" || kind === "close") break;
      const next = unary();
      if (next) runs.at(-1)!.push(next);
    }
    const children = runs
      .filter((run) => run.length > 0)
      .map((run): Node => (run.length === 1 ? run[0] : { kind: "and", explicit: false, children: run }));
    if (children.length === 0) return null;
    return children.length === 1 ? children[0] : { kind: "and", explicit: true, children };
  }

  function unary(): Node | null {
    const kind = peek();
    if (kind === null || kind === "close" || kind === "and" || kind === "or") return null;
    if (kind === "not") {
      i++;
      const child = unary();
      return child && { kind: "not", child };
    }
    if (kind === "open") {
      const open = order[i++];
      const child = or();
      const close = peek() === "close" ? order[i++] : null;
      return { kind: "group", open, close, child };
    }
    return { kind: "leaf", at: order[i++] };
  }

  const roots: Node[] = [];
  while (i < order.length) {
    const root = or();
    if (root) roots.push(root);
    // A ")" with no "(" ends the expression early: mark it and carry on after it.
    if (peek() === "close") tokens[order[i++]].unmatched = true;
  }
  if (roots.length === 0) return null;
  return roots.length === 1 ? roots[0] : { kind: "and", explicit: false, children: roots };
}

function hasExplicitAnd(node: Node | null): boolean {
  if (!node) return false;
  switch (node.kind) {
    case "leaf":
      return false;
    case "not":
      return hasExplicitAnd(node.child);
    case "group":
      return hasExplicitAnd(node.child);
    case "and":
      return node.explicit || node.children.some(hasExplicitAnd);
    case "or":
      return node.children.some(hasExplicitAnd);
  }
}

/** `expansions` are the person's saved shortcuts; a known one stands for its expansion's terms. */
export function parseBooleanQuery(query: string, expansions: ShortcutExpansions = {}): ParsedQuery {
  const tokens = tokenize(query);
  let conceptCount = 0;

  /** Colours the subtree with `concept`, or splits it into new concepts when none is given. */
  function assign(node: Node | null, concept: number | undefined, excluded: boolean): Set<number> {
    const used = new Set<number>();
    if (!node) return used;
    const merge = (from: Set<number>) => from.forEach((c) => used.add(c));
    switch (node.kind) {
      case "leaf": {
        const token = tokens[node.at];
        if (token.kind !== "term" && token.kind !== "phrase") break;
        if (excluded) token.excluded = true;
        else {
          token.concept = concept ?? conceptCount++;
          used.add(token.concept);
        }
        break;
      }
      case "not":
        assign(node.child, undefined, true);
        break;
      case "group": {
        merge(assign(node.child, concept, excluded));
        const shared = used.size === 1 ? [...used][0] : undefined;
        tokens[node.open].concept = shared;
        if (excluded) {
          tokens[node.open].excluded = true;
          if (node.close !== null) tokens[node.close].excluded = true;
        }
        if (node.close === null) tokens[node.open].unmatched = true;
        else tokens[node.close].concept = shared;
        break;
      }
      case "and":
      case "or":
        if (concept !== undefined || excluded || !hasExplicitAnd(node)) {
          const own = concept ?? (excluded ? undefined : conceptCount++);
          node.children.forEach((child) => merge(assign(child, own, excluded)));
        } else node.children.forEach((child) => merge(assign(child, undefined, false)));
        break;
    }
    return used;
  }

  assign(parse(tokens), undefined, false);

  const concepts: string[][] = Array.from({ length: conceptCount }, () => []);
  for (const token of tokens) {
    if (token.concept === undefined || (token.kind !== "term" && token.kind !== "phrase")) continue;
    const name = token.kind === "term" ? shortcutNameOf(token.text) : undefined;
    const expansion = name !== undefined && Object.hasOwn(expansions, name) ? expansions[name] : undefined;
    if (!expansion) concepts[token.concept].push(token.text);
    else {
      const terms = parseBooleanQuery(expansion).tokens.filter((t) => t.concept !== undefined && (t.kind === "term" || t.kind === "phrase"));
      concepts[token.concept].push(...terms.map((t) => t.text));
    }
  }
  return { tokens, conceptCount, concepts };
}

// ---------- Matching in result text ----------

const WORD = /[\p{L}\p{N}]+/gu;

/** Elasticsearch's English stop words, which OpenAlex drops from stemmed searches. */
const STOP_WORDS = new Set(
  "a an and are as at be but by for if in into is it no not of on or such that the their then there these they this to was will with".split(" "),
);

/** Tests one word of the result text, given lower-cased, with its stem worked out on demand. */
type WordTest = (word: string, stem: () => string) => boolean;

/** A phrase's words, each at its place in the phrase; a dropped stop word leaves its place empty. */
type Phrase = { test: WordTest; offset: number }[];

type TermMatcher = { concept: number } & (
  /** Words one after another, or within `slop` position moves of that ("a b"~N). */
  | { phrase: Phrase; slop: number | null }
  /** Two phrases, each intact, within `distance` words of each other in either order ("a b"~N~"c d"). */
  | { near: [Phrase, Phrase]; distance: number }
);

/** Edit distance (insertions, deletions, substitutions), stopping early once it passes `limit`. */
function withinEdits(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    if (Math.min(...row) > limit) return false;
    previous = row;
  }
  return previous[b.length] <= limit;
}

/**
 * How one query word matches, as OpenAlex runs it: stemmed (Kstem) on the default search, as
 * written on the exact search a wildcard calls for. `edits` is a fuzzy term's allowance (`word~1`),
 * which OpenAlex checks against the indexed form.
 * ponytail: Porter stands in for Kstem and over-matches a little ("educator" finds "education").
 */
function wordTest(word: string, stemmed: boolean, edits?: number): WordTest | null {
  const lower = word.toLowerCase();
  if (/[*?]/.test(lower)) {
    const source = lower.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[\\p{L}\\p{N}]*").replace(/\?/g, "[\\p{L}\\p{N}]");
    const pattern = new RegExp(`^${source}$`, "u");
    return (text) => pattern.test(text);
  }
  if (stemmed && STOP_WORDS.has(lower)) return null;
  if (edits !== undefined) {
    return stemmed ? (_, stem) => withinEdits(stem(), lower, edits) : (text) => withinEdits(text, lower, edits);
  }
  if (!stemmed) return (text) => text === lower;
  const target = stemmer(lower);
  return (_, stem) => stem() === target;
}

function phraseOf(text: string, stemmed: boolean, edits?: number): Phrase {
  const words = [...text.replace(/\.{3}$/, "").matchAll(/[\p{L}\p{N}*?]+/gu)].map((match) => match[0]);
  return words.flatMap((word, offset) => {
    const test = wordTest(word, stemmed, edits);
    return test ? [{ test, offset }] : [];
  });
}

function termMatcher(text: string, concept: number, stemmed: boolean): TermMatcher | null {
  const near = text.match(/^"([^"]*)"~(\d+)~"([^"]*)"?$/);
  if (near) {
    const pair: [Phrase, Phrase] = [phraseOf(near[1], stemmed), phraseOf(near[3], stemmed)];
    return pair.every((phrase) => phrase.length > 0) ? { concept, near: pair, distance: Number(near[2]) } : null;
  }
  const tilde = text.match(/~(\d+)$/);
  const body = text.replace(/~\d+$/, "");
  // `"a b"~N` loosens a phrase; `word~N` allows N edits to a single word.
  const fuzzy = tilde && !body.startsWith('"') ? Math.min(Number(tilde[1]), 2) : undefined;
  const phrase = phraseOf(body, stemmed, fuzzy);
  if (phrase.length === 0) return null;
  return { concept, phrase, slop: tilde && fuzzy === undefined && phrase.length > 1 ? Number(tilde[1]) : null };
}

export interface QueryMatcher {
  terms: TermMatcher[];
}

/** One matcher per searched term, each tagged with its concept, built from the query as typed and the person's shortcuts. */
export function queryMatcher(query: string, expansions: ShortcutExpansions = {}): QueryMatcher | null {
  const { concepts } = parseBooleanQuery(query, expansions);
  // An unquoted wildcard anywhere sends the whole search, shortcuts expanded, to the exact field.
  const stemmed = !hasUnquotedWildcard(expandShortcuts(query, expansions).expandedQuery);
  const terms = concepts.flatMap((texts, concept) =>
    texts.flatMap((text) => termMatcher(text, concept, stemmed) ?? []),
  );
  return terms.length > 0 ? { terms } : null;
}

export interface TextSegment {
  text: string;
  concept?: number;
}

type Word = { start: number; end: number; lower: string; stem?: string };
type Hit = { start: number; end: number; concept: number };

/**
 * Places for a sloppy phrase's words, one word each, whose cost is within `slop`. The cost is
 * Lucene's: how far apart the words' shifts from their places in the phrase are, so "b a" for
 * "a b" costs 2. Tries each place for the first word and keeps the first fit found.
 */
function sloppyFits(phrase: Phrase, slop: number, count: number, test: (at: number, word: WordTest) => boolean): number[][] {
  const fits: number[][] = [];
  const place = (index: number, taken: number[], low: number, high: number): number[] | null => {
    if (index === phrase.length) return taken;
    const { test: word, offset } = phrase[index];
    for (let shift = high - slop; shift <= low + slop; shift++) {
      const at = offset + shift;
      if (at < 0 || at >= count || taken.includes(at) || !test(at, word)) continue;
      const found = place(index + 1, [...taken, at], Math.min(low, shift), Math.max(high, shift));
      if (found) return found;
    }
    return null;
  };
  for (let first = 0; first < count; first++) {
    if (!test(first, phrase[0].test)) continue;
    const shift = first - phrase[0].offset;
    const found = place(1, [first], shift, shift);
    if (found) fits.push(found);
  }
  return fits;
}

/** Where a phrase's words sit one after another: the first and last word index of each run. */
function phraseRuns(phrase: Phrase, count: number, test: (at: number, word: WordTest) => boolean): [number, number][] {
  const first = phrase[0].offset;
  const last = phrase.at(-1)!.offset;
  const runs: [number, number][] = [];
  for (let at = 0; at + last - first < count; at++) {
    if (phrase.every(({ test: word, offset }) => test(at + offset - first, word))) runs.push([at, at + last - first]);
  }
  return runs;
}

/** Splits text into plain runs and matches; where matches overlap, the earlier then longer wins. */
export function highlightSegments(text: string, matcher: QueryMatcher | null): TextSegment[] {
  if (!matcher || !text) return [{ text }];
  const words: Word[] = [...text.matchAll(WORD)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    lower: match[0].toLowerCase(),
  }));
  const test = (at: number, word: WordTest) => {
    const entry = words[at];
    return entry !== undefined && word(entry.lower, () => (entry.stem ??= stemmer(entry.lower)));
  };
  const span = (from: number, to: number, concept: number): Hit => ({ start: words[from].start, end: words[to].end, concept });

  const hits: Hit[] = [];
  for (const term of matcher.terms) {
    if ("near" in term) {
      const [a, b] = term.near.map((phrase) => phraseRuns(phrase, words.length, test));
      for (const [aStart, aEnd] of a) {
        for (const [bStart, bEnd] of b) {
          const gap = aEnd < bStart ? bStart - aEnd - 1 : bEnd < aStart ? aStart - bEnd - 1 : -1;
          if (gap < 0 || gap > term.distance) continue;
          hits.push(span(aStart, aEnd, term.concept), span(bStart, bEnd, term.concept));
        }
      }
    } else if (term.slop === null) {
      for (const [from, to] of phraseRuns(term.phrase, words.length, test)) hits.push(span(from, to, term.concept));
    } else {
      for (const fit of sloppyFits(term.phrase, term.slop, words.length, test)) {
        for (const at of fit) hits.push(span(at, at, term.concept));
      }
    }
  }

  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: TextSegment[] = [];
  let at = 0;
  for (const hit of hits) {
    if (hit.start < at) continue;
    if (hit.start > at) segments.push({ text: text.slice(at, hit.start) });
    segments.push({ text: text.slice(hit.start, hit.end), concept: hit.concept });
    at = hit.end;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}
