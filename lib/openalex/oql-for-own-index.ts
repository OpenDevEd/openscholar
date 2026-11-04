/**
 * OQL as our own index reads it. OpenAlex's OQL is forgiving and ours is strict, so a query that runs on OpenAlex can be
 * refused on our index for how it's written, not for what it asks. This rewrites what OpenAlex accepts into the same
 * query in the form ours takes. Each rewrite was checked on OpenAlex, where both spellings give the same count, and on
 * our API, which takes the result (2026-11-04, about 200 query forms against both).
 *
 *   type is article              type is (article)
 *   title has "kelp forest"      title has ("kelp forest")
 *   citation count is above 10   citation count > (10)
 *   it's open access             open access is (true)
 *   published since 2020         year >= (2020)
 *   type is ([a](a) or [b](b))   type is (a or b)
 *   type is (a and b)            type is (a) and type is (b)
 *   get works where ...          works where ...
 *
 * It reads the query as our API's own lexer and grammar do (openscholar-api src/core/oql), a token at a time, so words
 * inside a quoted phrase or a search's text are never touched: `title has ("it is false")` stays as it is. It only
 * changes what it fully understands. Anything else goes through as written, for the API to refuse with its own reason,
 * so a query never silently comes to mean something else.
 */

type Token = { kind: "word" | "quoted" | "comparison" | "open" | "close"; text: string; at: number; end: number };
type Edit = { at: number; end: number; text: string };
/** Where a clause's field stands, and whether its verb is negated, for a group that becomes a clause per value. */
type Clause = { field: { at: number; end: number }; negated: boolean };

const COMPARISON = /^(?:>=|<=|>|<)/;
const WORD = /^[^\s()[\]"<>]+/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR = /^\d{4}$/;

/**
 * Curly quotes and apostrophes as plain ones, outside straight quotes: word processors write them, and OpenAlex takes
 * them. One character for one, so every position stays where it was.
 */
function straightened(query: string): string {
  let inside = false;
  let out = "";
  for (const character of query) {
    if (character === '"') inside = !inside;
    if (inside) out += character;
    else if (character === "“" || character === "”") out += '"';
    else if (character === "’") out += "'";
    else out += character;
  }
  return out;
}

/** The query's tokens, or null when it can't be read, such as an unclosed quote. A `[label]` reads as no token. */
function tokensOf(query: string): Token[] | null {
  const tokens: Token[] = [];
  let at = 0;
  while (at < query.length) {
    const character = query.charAt(at);
    if (/\s/.test(character)) {
      at += 1;
    } else if (character === "(" || character === ")") {
      tokens.push({ kind: character === "(" ? "open" : "close", text: character, at, end: at + 1 });
      at += 1;
    } else if (character === '"' || character === "[") {
      const close = query.indexOf(character === '"' ? '"' : "]", at + 1);
      if (close === -1) return null;
      if (character === '"') tokens.push({ kind: "quoted", text: query.slice(at + 1, close), at, end: close + 1 });
      at = close + 1;
    } else {
      const rest = query.slice(at);
      const comparison = COMPARISON.exec(rest)?.[0];
      const word = comparison ? undefined : WORD.exec(rest)?.[0];
      const text = comparison ?? word;
      if (!text) return null;
      tokens.push({ kind: comparison ? "comparison" : "word", text, at, end: at + text.length });
      at += text.length;
    }
  }
  return tokens;
}

const isWord = (token: Token | undefined, word: string) => token?.kind === "word" && token.text.toLowerCase() === word;

/** Whether these words stand at `index`, in any case. */
const wordsAt = (tokens: Token[], index: number, words: readonly string[]) => words.every((word, offset) => isWord(tokens[index + offset], word));

/** The index of the bracket that closes the one at `open`; -1 when none does. */
function closeOf(tokens: Token[], open: number) {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    if (tokens[index].kind === "open") depth += 1;
    if (tokens[index].kind === "close" && --depth === 0) return index;
  }
  return -1;
}

/** Whether a clause has ended at this token: the query's end, a closing bracket or a word that follows a clause. */
const endsClause = (token: Token | undefined) =>
  token === undefined || token.kind === "close" || ["and", "or", "sample", "group"].some((word) => isWord(token, word));

/** Yes/no sentences our index reads as fields, longest first: `it's not ...` before `it's ...`. */
const YES_NO: ReadonlyArray<readonly [readonly string[], string]> = [
  [["it's", "not", "open", "access"], "open access is (false)"],
  [["it's", "closed", "access"], "open access is (false)"],
  [["it's", "open", "access"], "open access is (true)"],
  [["it's", "not", "retracted"], "retracted is (false)"],
  [["it's", "retracted"], "retracted is (true)"],
  [["it's", "not", "in", "the", "top", "10%", "by", "citations"], "citation_normalized_percentile.is_in_top_10_percent is (false)"],
  [["it's", "in", "the", "top", "10%", "by", "citations"], "citation_normalized_percentile.is_in_top_10_percent is (true)"],
  [["it's", "not", "in", "the", "top", "1%", "by", "citations"], "citation_normalized_percentile.is_in_top_1_percent is (false)"],
  [["it's", "in", "the", "top", "1%", "by", "citations"], "citation_normalized_percentile.is_in_top_1_percent is (true)"],
  [["it", "doesn't", "have", "a", "doi"], "has doi is (false)"],
  [["it", "has", "a", "doi"], "has doi is (true)"],
  [["it", "doesn't", "have", "an", "abstract"], "has abstract is (false)"],
  [["it", "has", "an", "abstract"], "has abstract is (true)"],
  [["it", "doesn't", "have", "full", "text"], "has_fulltext is (false)"],
  [["it", "has", "full", "text"], "has_fulltext is (true)"],
];

const RELATIONS: ReadonlyArray<readonly string[]> = [["it", "cites"], ["it's", "cited", "by"], ["it's", "related", "to"]];

/** Word comparisons, with what our index writes for each. */
const WORD_COMPARISONS: ReadonlyArray<readonly [readonly string[], string]> = [
  [["is", "at", "least"], ">="],
  [["is", "at", "most"], "<="],
  [["is", "above"], ">"],
  [["is", "below"], "<"],
];

/** The day before a date, for `before`, which leaves the date out where `to_publication_date` keeps it. */
function dayBefore(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) return null;
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** `published <verb> <year or date>` as a clause our index reads; null for what OpenAlex itself refuses or we don't read. */
function publishedClause(verb: string, value: string): string | null {
  if (YEAR.test(value)) {
    const operator = { since: ">=", before: "<", after: ">", through: "<=" }[verb];
    if (operator) return `year ${operator} (${value})`;
    return verb === "in" ? `year is (${value})` : null;
  }
  if (!DATE.test(value) || dayBefore(value) === null) return null;
  if (verb === "since") return `from_publication_date is (${value})`;
  if (verb === "through") return `to_publication_date is (${value})`;
  return verb === "before" ? `to_publication_date is (${dayBefore(value)})` : null;
}

/**
 * Rewrites one clause from `start`, and says where the next token to read is. A clause it doesn't recognise is left as
 * it is: the index after it comes from the next operator or the clause's end, so the rest of the query is still read.
 */
function readClause(query: string, tokens: Token[], start: number, edits: Edit[]): number {
  for (const [words, clause] of YES_NO) {
    if (wordsAt(tokens, start, words) && endsClause(tokens[start + words.length])) {
      edits.push({ at: tokens[start].at, end: tokens[start + words.length - 1].end, text: clause });
      return start + words.length;
    }
  }
  if (isWord(tokens[start], "published") && tokens[start + 1]?.kind === "word" && tokens[start + 2]?.kind === "word" && endsClause(tokens[start + 3])) {
    const clause = publishedClause(tokens[start + 1].text.toLowerCase(), tokens[start + 2].text);
    if (clause) {
      edits.push({ at: tokens[start].at, end: tokens[start + 2].end, text: clause });
      return start + 3;
    }
  }
  const relation = RELATIONS.find((words) => wordsAt(tokens, start, words));
  if (relation) return readValues(query, tokens, start + relation.length, edits, null);

  // A field runs up to its operator. Its first word is never one, as in `has doi is (true)`. One field has `and` in its name.
  const named = wordsAt(tokens, start, ["title", "and", "abstract"]) ? start + 2 : start;
  for (let index = named; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "word" && token.kind !== "comparison") return index;
    if (index > start) {
      if (endsClause(token)) return index;
      const worded = WORD_COMPARISONS.find(([words]) => wordsAt(tokens, index, words));
      if (worded) {
        const after = index + worded[0].length;
        edits.push({ at: token.at, end: tokens[after - 1].end, text: worded[1] });
        return readValues(query, tokens, after, edits, null);
      }
      if (token.kind === "comparison") return readValues(query, tokens, index + 1, edits, null);
      if (isWord(token, "has")) return readText(tokens, index + 1, edits);
      if (isWord(token, "is")) {
        // `is similar to` isn't a value: the API says it isn't served.
        if (isWord(tokens[index + 1], "similar")) return index + 1;
        const negated = isWord(tokens[index + 1], "not");
        return readValues(query, tokens, index + (negated ? 2 : 1), edits, { field: { at: tokens[start].at, end: tokens[index - 1].end }, negated });
      }
    }
  }
  return tokens.length;
}

/** A search's text after `has`: left alone in brackets, and one word or phrase put in them. Several bare words are refused by OpenAlex too. */
function readText(tokens: Token[], index: number, edits: Edit[]): number {
  const first = tokens[index];
  if (first?.kind === "open") {
    const close = closeOf(tokens, index);
    return close === -1 ? tokens.length : close + 1;
  }
  const stemmed = isWord(first, "stemmed") && tokens[index + 1]?.kind === "quoted";
  const last = stemmed ? index + 1 : index;
  const value = tokens[last];
  if ((value?.kind !== "word" && value?.kind !== "quoted") || !endsClause(tokens[last + 1])) return index;
  edits.push({ at: first.at, end: first.at, text: "(" }, { at: value.end, end: value.end, text: ")" });
  return last + 1;
}

/**
 * The values of `is`, a comparison or a relation. One bare value goes in brackets. In a group, a `[name](ID)` link becomes
 * its ID. A group joined by `and`, which our index doesn't take, becomes a clause per value, when `clause` says which
 * field it's on: `type is (a and not b)` is `type is (a) and type is not (b)`.
 */
function readValues(query: string, tokens: Token[], index: number, edits: Edit[], clause: Clause | null): number {
  const first = tokens[index];
  if (first?.kind === "open") {
    const close = closeOf(tokens, index);
    if (close === -1) return tokens.length;
    rewriteGroup(query, tokens, index, close, edits, clause);
    return close + 1;
  }
  if ((first?.kind !== "word" && first?.kind !== "quoted") || !endsClause(tokens[index + 1])) return index;
  edits.push({ at: first.at, end: first.at, text: "(" }, { at: first.end, end: first.end, text: ")" });
  return index + 1;
}

/** Rewrites the values between `open` and `close` if each is a link or a value, joined by only `or` or only `and`. Anything else, such as a nested group, stays as it is. */
function rewriteGroup(query: string, tokens: Token[], open: number, close: number, edits: Edit[], clause: Clause | null) {
  const values: Array<{ text: string; negated: boolean }> = [];
  const joiners = new Set<string>();
  let index = open + 1;
  while (index < close) {
    const negated = isWord(tokens[index], "not");
    if (negated) index += 1;
    const token = tokens[index];
    if (token?.kind === "open") {
      // A link: its label read as nothing, so its ID stands in brackets of its own.
      const inner = tokens[index + 1];
      if (inner?.kind !== "word" || tokens[index + 2]?.kind !== "close" || !query.slice(tokens[index - 1]?.end ?? 0, token.at).includes("]")) return;
      values.push({ text: inner.text, negated });
      index += 3;
    } else if (token?.kind === "word" || token?.kind === "quoted") {
      values.push({ text: query.slice(token.at, token.end), negated });
      index += 1;
    } else {
      return;
    }
    if (index >= close) break;
    const joiner = tokens[index];
    if (!isWord(joiner, "or") && !isWord(joiner, "and")) return;
    joiners.add(joiner.text.toLowerCase());
    index += 1;
  }
  if (!values.length || joiners.size > 1) return;
  const inside = { at: tokens[open].at, end: tokens[close].end };
  const written = query.slice(inside.at, inside.end);
  if (joiners.has("and")) {
    if (!clause || clause.negated) return;
    const field = query.slice(clause.field.at, clause.field.end);
    edits.push({
      at: clause.field.at,
      end: inside.end,
      text: `(${values.map((value) => `${field} is ${value.negated ? "not " : ""}(${value.text})`).join(" and ")})`,
    });
    return;
  }
  const rewritten = `(${values.map((value) => `${value.negated ? "not " : ""}${value.text}`).join(" or ")})`;
  // Only a group that held a link needs writing again; any other keeps its own spacing.
  if (written.includes("[")) edits.push({ ...inside, text: rewritten });
  return;
}

/** Reads the conditions from `start`: `not`, brackets around conditions, clauses and what joins them. */
function readConditions(query: string, tokens: Token[], start: number, edits: Edit[]) {
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.kind === "open" || token.kind === "close" || isWord(token, "not") || isWord(token, "and") || isWord(token, "or")) {
      index += 1;
    } else if (isWord(token, "sample") || isWord(token, "group")) {
      return;
    } else {
      const next = readClause(query, tokens, index, edits);
      // Every clause moves on, even one it can't read.
      index = next > index ? next : index + 1;
    }
  }
}

/**
 * Whether a query is OpenAlex's sentence form, such as `get works about kelp`, alone or as the app wraps it to add filters.
 * Its filters can't be joined to a sentence, and our index doesn't read one, so it's refused with how to write it.
 */
export function isOqlSentence(query: string) {
  const start = query.trim().toLowerCase().replace(/^works\s+where\s+\(\s*/, "");
  return /^get\b/.test(start) && !/^get\s+works(?:\s+where\b|\s*$)/.test(start);
}

/** Why a sentence isn't run, and how to write it, in the form the search page shows. */
export const OQL_SENTENCE_REFUSAL = {
  problem: "This search runs queries that start with works where, not sentences that start with get",
  fix: 'Write it as works where title/abstract has (kelp) and year is (2024)',
};

/** The query in the form our index reads; as it was when it can't be read. Rewriting its own result changes nothing. */
export function oqlForOwnIndex(query: string): string {
  const straight = straightened(query);
  const leading = /^\s*get\s+(?=works\b)/i.exec(straight)?.[0].length ?? 0;
  const text = isOqlSentence(straight) ? straight : straight.slice(leading);
  const tokens = tokensOf(text);
  if (!tokens) return text;
  const where = tokens.findIndex((token) => isWord(token, "where"));
  if (!isWord(tokens[0], "works") || where !== 1) return text;
  const edits: Edit[] = [];
  readConditions(text, tokens, where + 1, edits);
  // From the end, so each edit's positions still hold. An insertion at the same place keeps the order it was added in.
  return edits
    .map((edit, order) => ({ ...edit, order }))
    .sort((a, b) => b.at - a.at || b.order - a.order)
    .reduce((written, edit) => written.slice(0, edit.at) + edit.text + written.slice(edit.end), text);
}
