import { viewOf } from "./actions";

/** What deciding a step's card needs of it. */
type CardStep = { status: string; action: string; variant?: string; canUndo?: boolean; undone?: boolean; error?: string; batch?: unknown; credits?: number };

/** Whether a step leaves its card nothing to press and nothing to read but that it ran: no undo, no error, no answer it waits for, no credits. */
const folds = (step: CardStep) => (step.status === "done" || step.status === "running") && !step.canUndo && !step.undone && !step.error && step.batch === undefined && step.credits === undefined;

/**
 * The steps of a reply as its map's cards (components/assistant/steps.tsx): every step of the
 * reply that folds and would show the same card, whichever action it ran, is one card that says
 * how many times, where the first of them ran. A reply that counted papers thirty-nine times ran
 * thirty-nine cards down the page, and one that read a screening three ways, between reading
 * papers, showed three "Read a screening" cards. opencode folds a run of reads into one row the
 * same way (its context tool group). A step with an undo, an error or a question is always its
 * own card, in its place.
 */
export function runsOf<S extends CardStep>(steps: S[]): S[][] {
  const runs: S[][] = [];
  const byCard = new Map<string, S[]>();
  for (const step of steps) {
    if (!folds(step)) {
      runs.push([step]);
      continue;
    }
    const { kind, words } = viewOf(step.action, step.variant);
    const card = `${kind}:${words}`;
    const run = byCard.get(card);
    if (run) run.push(step);
    else {
      byCard.set(card, [step]);
      runs.push(byCard.get(card)!);
    }
  }
  return runs;
}
