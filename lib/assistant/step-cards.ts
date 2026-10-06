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

/**
 * The steps a reply shows, in the order they ran: a read that failed is left out once the same
 * action worked in a later request of the reply, after the model was told of the failure. The
 * assistant recovered, and the error was written for it ("`about` takes at most 100 countries"),
 * not for the person reading. A failed read it never got past, one beside a call of the same
 * action that worked in the same request, and every failed change, stay.
 */
export function shownSteps<S extends CardStep & { reads?: true; request?: number }>(steps: S[]): S[] {
  const recovered = (step: S, later: S) => later.action === step.action && later.variant === step.variant && later.status === "done" && (later.request ?? -1) > (step.request ?? Infinity);
  return steps.filter((step, i) => !(step.reads && step.status === "failed" && steps.slice(i + 1).some((later) => recovered(step, later))));
}
