/**
 * @ in the assistant's composer points at one record in the person's account (#327). The
 * message carries it as `@[name](kind:id)`: the model reads the ID the tools take, the chat
 * shows a chip, and the chat list's preview drops the link to `@name`.
 */

export const MENTION_KINDS = ["search", "collection", "paper"] as const;
export type MentionKind = (typeof MENTION_KINDS)[number];
/** `id` is what the tools take: a search's ID, a collection's ID, a paper's OpenAlex ID. */
export type Mention = { kind: MentionKind; id: string; label: string };

const TOKEN = new RegExp(String.raw`@\[([^\]\n]+)\]\((${MENTION_KINDS.join("|")}):([^)\s]+)\)`, "g");

/** A name as it can sit between the token's brackets, on one line. */
const bracketSafe = (label: string) => label.replace(/\s+/g, " ").replace(/\[/g, "(").replace(/\]/g, ")").trim();

export const mentionToken = ({ kind, id, label }: Mention) => `@[${bracketSafe(label)}](${kind}:${id})`;

/** Splits a sent message into plain runs and the records it points at. */
export function mentionSegments(text: string): Array<string | Mention> {
  const out: Array<string | Mention> = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > at) out.push(text.slice(at, match.index));
    out.push({ label: match[1]!, kind: match[2] as MentionKind, id: match[3]! });
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** A sent message as plain text: each record it points at as `@name`. */
export const plainMentions = (text: string) =>
  mentionSegments(text)
    .map((part) => (typeof part === "string" ? part : `@${part.label}`))
    .join("");

/**
 * Splits a draft into plain runs and the picked records it still names as `@name`. Longest
 * name first, so a name that contains another still matches whole. A name edited after it
 * was picked, or with a letter or digit run on after it, is plain text again.
 */
export function draftSegments(text: string, picked: readonly Mention[]): Array<string | Mention> {
  if (!picked.length) return [text];
  const names = [...new Map(picked.map((m) => [m.label, m])).entries()].sort(([a], [b]) => b.length - a.length);
  const pattern = new RegExp(`@(${names.map(([name]) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  const byName = new Map(names);
  const out: Array<string | Mention> = [];
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > at) out.push(text.slice(at, match.index));
    out.push(byName.get(match[1]!)!);
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

const same = (a: Mention, b: Mention) => a.kind === b.kind && a.id === b.id;

/** The picked records a draft still names: the rest have nothing to stand for. */
export const stillNamed = (text: string, picked: readonly Mention[]) =>
  picked.filter((m) => draftSegments(text, picked).some((part) => typeof part !== "string" && same(part, m)));

/**
 * The name a pick is written with: its own, unless another record picked in the draft has it,
 * so that each name in a draft stands for one record. `kind` is the record's kind in words.
 */
export function uniqueLabel(mention: Mention, kind: string, picked: readonly Mention[]) {
  const taken = (label: string) => picked.some((m) => m.label === label && !same(m, mention));
  const base = taken(mention.label) ? `${mention.label} (${kind})` : mention.label;
  let label = base;
  for (let n = 2; taken(label); n++) label = `${base} ${n}`;
  return label;
}

/** The draft as it's sent: each picked `@name` becomes its token. */
export const withTokens = (text: string, picked: readonly Mention[]) =>
  draftSegments(text, picked)
    .map((part) => (typeof part === "string" ? part : mentionToken(part)))
    .join("");

/** Where an @ being typed starts, and what follows it, when the caret sits inside one. */
export function openMention(text: string, caret: number, picked: readonly Mention[]) {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]!))) return null;
  const query = before.slice(at + 1);
  // A finished mention, or a newline, ends it.
  if (query.includes("\n") || draftSegments(before.slice(at), picked).some((p) => typeof p !== "string")) return null;
  return { start: at, query };
}
