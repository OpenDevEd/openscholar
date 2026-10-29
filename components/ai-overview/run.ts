"use client";

// Mock (mock/ai-overview): one overview run, read from the route's stream as it's written, and
// its text cut into the paragraphs, charts and paper lists the card draws.

import type { SWRSubscriptionOptions } from "swr/subscription";
import type { OverviewEvent } from "@/app/api/overview-mock/route";
import { useLenses } from "./lenses";

type CountEvent = Extract<OverviewEvent, { t: "count" }>;
type PapersEvent = Extract<OverviewEvent, { t: "papers" }>;
export type Run = { step: string | null; counts: Record<string, CountEvent>; lists: Record<string, PapersEvent>; text: string; done: boolean; error?: string };

const EMPTY: Run = { step: null, counts: {}, lists: {}, text: "", done: false };

function apply(run: Run, event: OverviewEvent): Run {
  switch (event.t) {
    case "step":
      return { ...run, step: event.label };
    case "count":
      return { ...run, counts: { ...run.counts, [event.id]: event } };
    case "papers":
      return { ...run, lists: { ...run.lists, [event.id]: event } };
    case "text":
      return { ...run, text: run.text + event.text };
    case "done":
      return { ...run, step: null, done: true };
    case "error":
      return { ...run, step: null, done: true, error: event.message };
  }
}

/** Runs written in full this visit, so going back to a lens or a search shows it again without a new run. */
const finished = new Map<string, Run>();

/** A useSWRSubscription source: the key's run, from the cache or from a new request. */
export function subscribeRun([, runKey, body]: [string, string, string], { next }: SWRSubscriptionOptions<Run, Error>) {
  const cached = finished.get(runKey);
  if (cached) {
    next(null, cached);
    return () => {};
  }
  const controller = new AbortController();
  let run = EMPTY;
  (async () => {
    const response = await fetch("/api/overview-mock", { method: "POST", body, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`The overview didn't start (${response.status}).`);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line) run = apply(run, JSON.parse(line) as OverviewEvent);
      next(null, run);
    }
    if (!run.done) run = { ...run, done: true, error: "The overview stopped before it finished." };
    next(null, run);
    if (!run.error) {
      finished.set(runKey, run);
      // The free plan pays in credits; Go and above count against the daily cap.
      if (!useLenses.getState().freePlan) useLenses.getState().spend();
    }
  })().catch((error: unknown) => {
    if (!controller.signal.aborted) next(error instanceof Error ? error : new Error(String(error)));
  });
  return () => controller.abort();
}

export type Cite = { id: string; text: string };
export type Block = { kind: "text"; parts: Array<string | Cite> } | { kind: "chart"; id: string; change: boolean } | { kind: "papers"; id: string };

const MARKER = /\[(chart|papers):(\w+)(:change)?\]/g;
const CITE = /\[([^\]]+)\]\(paper:(W\d+)\)/g;

/** A paragraph's words, with each cited paper as a chip. */
function textBlock(line: string): Block[] {
  const text = line.trim();
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

/**
 * The run's text as the card draws it, a whole line at a time: the line still being written waits for its end, so a
 * paragraph arrives once and never grows in place. A chart's marker is drawn after its paragraph, wherever in the line
 * the model put it.
 */
export function blocksOf(text: string, writing: boolean): Block[] {
  const body = (writing ? text.slice(0, text.lastIndexOf("\n") + 1) : text).replace(/\*\*|__/g, "");
  return body.split(/\n+/).flatMap((line): Block[] => {
    const markers = [...line.matchAll(MARKER)].map((m): Block => (m[1] === "chart" ? { kind: "chart", id: m[2], change: Boolean(m[3]) } : { kind: "papers", id: m[2] }));
    return [...textBlock(line.replace(MARKER, "")), ...markers];
  });
}

/** The overview as text to paste: its paragraphs, with each cited paper's words. */
export const plainText = (blocks: Block[]) =>
  blocks.flatMap((b) => (b.kind === "text" ? [b.parts.map((p) => (typeof p === "string" ? p : p.text)).join("")] : [])).join("\n\n");
