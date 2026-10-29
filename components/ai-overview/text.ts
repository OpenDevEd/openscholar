// An AI overview's text (#967) cut into what the card draws: paragraphs with cited papers, and charts.

import type { Infer } from "convex/values";
import type { overviewListValidator } from "@/convex/research/overviewValidators";

export type Cite = { id: string; text: string };
export type Block = { kind: "text"; parts: Array<string | Cite> } | { kind: "chart"; id: string; change: boolean };
type List = Infer<typeof overviewListValidator>;

const MARKER = /\[chart:(\w+)(:change)?\]/g;
const CITE = /\[([^\]]+)\]\(paper:(W\d+)\)/g;

/** A paragraph's words, with each cited paper as a chip. */
function textBlock(line: string): Block[] {
  const text = line.replace(/\*\*|__/g, "").trim();
  if (!text) return [];
  const parts: Array<string | Cite> = [];
  let at = 0;
  for (const match of text.matchAll(CITE)) {
    if (match.index > at) parts.push(text.slice(at, match.index));
    parts.push({ text: match[1], id: match[2] });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return [{ kind: "text", parts }];
}

/** The text's paragraphs, each followed by the charts its line places, wherever in the line the model put them. */
export function blocksOf(text: string): Block[] {
  return text.split(/\n+/).flatMap((line): Block[] => [
    ...textBlock(line.replace(MARKER, "")),
    ...[...line.matchAll(MARKER)].map((m): Block => ({ kind: "chart", id: m[1], change: Boolean(m[2]) })),
  ]);
}

/** The papers an overview cites, each once, in the order it first cites them, as its paper lists gave them. */
export function citedPapers(blocks: Block[], lists: List[]) {
  const known = new Map(lists.flatMap((list) => list.papers.map((paper) => [paper.id, paper] as const)));
  const ids = [...new Set(blocks.flatMap((block) => (block.kind === "text" ? block.parts.flatMap((part) => (typeof part === "string" ? [] : [part.id])) : [])))];
  return ids.flatMap((id) => (known.has(id) ? [known.get(id)!] : []));
}

/** The overview as text to paste: its paragraphs, with each cited paper's words. */
export const plainText = (blocks: Block[]) =>
  blocks.flatMap((block) => (block.kind === "text" ? [block.parts.map((part) => (typeof part === "string" ? part : part.text)).join("")] : [])).join("\n\n");
