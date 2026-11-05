"use client";

// A signed-out visitor's AI overviews (#1070): read from /api/overviews as they're written and kept in this tab
// only, by search, lens and language. Nothing is stored: a reload writes them again, against the day's allowance.

import { create } from "zustand";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { trackOverview } from "@/lib/posthog-overview";
import { TurnstileCancelled } from "./turnstile";

type Overview = NonNullable<FunctionReturnType<typeof api.research.overviews.get>["overview"]>;
/** A run as the card shows it: an overview, or why a search has none. */
export type SignedOutRun = Overview | { unavailable: "oql" | "ratings" };
/** Why a visitor's overview failed: it couldn't be written, or Turnstile couldn't tell they're a person. */
export type FailedBecause = "failed" | "verify";

type State = {
  runs: Record<string, SignedOutRun & { because?: FailedBecause }>;
  /** The UTC day the visitor used that day's overviews: until it ends, what isn't written waits for them to sign in. */
  outOn: string | null;
  /** Overviews are switched off for visitors: the card goes. */
  off: boolean;
};
export const useSignedOutOverviews = create<State>(() => ({ runs: {}, outOn: null, off: false }));

/** Today in UTC, the day a visitor's allowance is counted by on the server. */
export const utcDay = () => new Date().toISOString().slice(0, 10);

const set = (key: string, run: State["runs"][string]) => useSignedOutOverviews.setState((state) => ({ runs: { ...state.runs, [key]: run } }));

/**
 * Has the overview of `key` written once, whatever asks for it: the card's subscription as it shows a lens, Write
 * again, or Try again. `request` is what /api/overviews takes besides the token.
 */
export async function ensureSignedOut(key: string, request: { params: string; lens: string; locale: string }, token: () => Promise<string>, trigger: "auto" | "again") {
  const { runs, outOn, off } = useSignedOutOverviews.getState();
  const had = runs[key];
  if (outOn === utcDay() || off || (had && (trigger === "auto" || ("status" in had && had.status === "running")))) return;
  let run: Overview = { status: "running", text: "", counts: [], lists: [], paid: false };
  set(key, run);
  trackOverview("overview_started", { signed_in: false, lens: request.lens, trigger, paid: false });
  const began = Date.now();
  const fail = (because: FailedBecause) => {
    set(key, { ...run, status: "failed", error: "failed", because });
    trackOverview("overview_failed", { signed_in: false, lens: request.lens, reason: because });
  };
  let proof: string;
  try {
    proof = await token();
  } catch (error) {
    // The card went before Turnstile answered: the overview starts again when its lens is shown again.
    if (error instanceof TurnstileCancelled) {
      return void useSignedOutOverviews.setState((state) => {
        const { [key]: _gone, ...kept } = state.runs;
        return { runs: kept };
      });
    }
    return fail("verify");
  }
  let answer: Response;
  try {
    answer = await fetch("/api/overviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request, token: proof }) });
  } catch {
    return fail("failed");
  }
  if (!answer.body) return fail("failed");
  const reader = answer.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const whole = buffer.split("\n");
      buffer = whole.pop() ?? "";
      for (const line of whole) {
        if (!line.trim()) continue;
        const part = JSON.parse(line) as Record<string, unknown>;
        if (part.limit) {
          useSignedOutOverviews.setState((state) => {
            const { [key]: _left, ...kept } = state.runs;
            return { runs: kept, outOn: utcDay() };
          });
          trackOverview("overview_limit_reached", { signed_in: false, lens: request.lens });
          return;
        }
        if (part.off) return void useSignedOutOverviews.setState({ off: true });
        if (part.unavailable === "oql" || part.unavailable === "ratings") return set(key, { unavailable: part.unavailable });
        if (part.verify) return fail("verify");
        if (part.failed || part.signedIn) return fail("failed");
        if (typeof part.step === "string") run = { ...run, step: part.step };
        if (part.count) run = { ...run, counts: [...run.counts, part.count as Overview["counts"][number]] };
        if (part.list) run = { ...run, lists: [...run.lists, part.list as Overview["lists"][number]] };
        if (typeof part.text === "string") run = { ...run, text: part.text };
        if (part.done) {
          run = { ...run, status: "done", step: undefined };
          trackOverview("overview_written", { signed_in: false, lens: request.lens, ms: Date.now() - began, counts: run.counts.length, papers: new Set(run.lists.flatMap((list) => list.papers.map((paper) => paper.id))).size, chars: run.text.length });
        }
        set(key, run);
      }
    }
  } catch {
    return fail("failed");
  }
  // The stream ended without saying it was done: the run broke off.
  if (run.status === "running") fail("failed");
}
