import { stemmer } from "stemmer";
import { hasUnquotedWildcard } from "./wildcard";

/**
 * Reads an OpenAlex boolean search (AND, OR, NOT, parentheses, quoted phrases, `"a b"~N`,
 * `*` and `?` wildcards) into concepts, so the query box and the results colour each one the
 * same way. Terms joined by OR are one concept. Each side of an explicit AND is its own concept.
 * Words side by side with no operator stay one concept. Terms under NOT are excluded.
 */

export type QueryTokenKind = "space" | "open" | "close" | "and" | "or" | "not" | "term" | "phrase";

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

const TOKEN = /(\s+)|(\()|(\))|("[^"]*"?(?:~\d+)?)|([^\s()"]+)/g;
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

export function parseBooleanQuery(query: string): ParsedQuery {
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
    concepts[token.concept].push(token.text);
  }
  return { tokens, conceptCount, concepts };
}


// ---------- Matching in result text ----------

const WORD = /[\p{L}\p{N}]+/gu;

/** Tests one word of the result text, given lower-cased, with its stem worked out on demand. */
type WordTest = (word: string, stem: () => string) => boolean;

type TermMatcher = {
  concept: number;
  words: WordTest[];
  /** Words a proximity phrase ("a b"~N) may have between its own; null when they must be adjacent. */
  slop: number | null;
};

/**
 * OpenAlex stems bare words (Kstem) and takes quoted phrases and wildcard searches as written.
 * ponytail: Porter stands in for Kstem and over-matches a little ("educator" finds "education").
 */
function wordTest(word: string, stemmed: boolean): WordTest {
  const lower = word.toLowerCase();
  if (/[*?]/.test(lower)) {
    const pattern = new RegExp(`^${lower.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[\\p{L}\\p{N}]*").replace(/\?/g, "[\\p{L}\\p{N}]")}$`, "u");
    return (text) => pattern.test(text);
  }
  if (!stemmed) return (text) => text === lower;
  const target = stemmer(lower);
  return (_, stem) => stem() === target;
}

function termMatcher(text: string, concept: number, fieldStemmed: boolean): TermMatcher | null {
  const proximity = text.match(/~(\d+)$/);
  const quoted = text.startsWith('"');
  const body = text.replace(/~\d+$/, "").replace(/\.{3}$/, "");
  const words = [...body.matchAll(/[\p{L}\p{N}*?]+/gu)].map((match) => wordTest(match[0], fieldStemmed && !quoted));
  if (words.length === 0) return null;
  return { concept, words, slop: proximity && words.length > 1 ? Number(proximity[1]) : null };
}

export interface QueryMatcher {
  terms: TermMatcher[];
}

/** One matcher per searched term, each tagged with its concept, built from the query that was actually searched. */
export function queryMatcher(query: string): QueryMatcher | null {
  const { concepts } = parseBooleanQuery(query);
  const stemmed = !hasUnquotedWildcard(query);
  const terms = concepts.flatMap((texts, concept) =>
    texts.flatMap((text) => termMatcher(text, concept, stemmed) ?? []),
  );
  return terms.length > 0 ? { terms } : null;
}

export interface TextSegment {
  text: string;
  concept?: number;
}

type Hit = { start: number; end: number; concept: number };

/** Splits text into plain runs and matches; where matches overlap, the earlier then longer wins. */
export function highlightSegments(text: string, matcher: QueryMatcher | null): TextSegment[] {
  if (!matcher || !text) return [{ text }];
  const words = [...text.matchAll(WORD)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    lower: match[0].toLowerCase(),
    stem: undefined as string | undefined,
  }));
  const test = (at: number, word: WordTest) => {
    const entry = words[at];
    return entry !== undefined && word(entry.lower, () => (entry.stem ??= stemmer(entry.lower)));
  };

  const hits: Hit[] = [];
  for (const term of matcher.terms) {
    const count = term.words.length;
    if (term.slop === null) {
      // A phrase: its words one after another, marked as one stretch.
      for (let at = 0; at + count <= words.length; at++) {
        if (term.words.every((word, offset) => test(at + offset, word))) {
          hits.push({ start: words[at].start, end: words[at + count - 1].end, concept: term.concept });
        }
      }
      continue;
    }
    // A proximity phrase: every word inside one window, each marked on its own.
    const span = count + term.slop;
    const marked = new Set<number>();
    for (let start = 0; start < words.length; start++) {
      const found = term.words.map((word) => {
        for (let at = start; at < Math.min(start + span, words.length); at++) if (test(at, word)) return at;
        return -1;
      });
      if (found.every((at) => at >= 0)) found.forEach((at) => marked.add(at));
    }
    marked.forEach((at) => hits.push({ start: words[at].start, end: words[at].end, concept: term.concept }));
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
