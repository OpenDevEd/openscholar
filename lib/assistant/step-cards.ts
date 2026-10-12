import { viewOf } from "./actions";

/** What deciding a step's card needs of it. */
type CardStep = { status: string; action: string; variant?: string; batch?: unknown; credits?: number };

/**
 * Whether a step's card can stand for several: it ran, or failed, as one call. A bulk change
 * is one card for many already, and a step that waits for an answer is its own question.
 */
const folds = (step: CardStep) => (step.status === "done" || step.status === "running" || step.status === "failed") && step.batch === undefined;

/** The steps in lists, in the order the first of each list was met: each list the steps `keyOf` gives one key. A step it gives none is a list of its own. */
function grouped<S>(steps: S[], keyOf: (step: S) => string | null): S[][] {
  const groups: S[][] = [];
  const byKey = new Map<string, S[]>();
  for (const step of steps) {
    const key = keyOf(step);
    const group = key === null ? undefined : byKey.get(key);
    if (group) group.push(step);
    else {
      groups.push([step]);
      if (key !== null) byKey.set(key, groups.at(-1)!);
    }
  }
  return groups;
}

/**
 * The steps of a reply as its map's cards (components/assistant/steps.tsx): every step of the
 * reply that folds and would show the same card, whichever action it ran, is one card that says
 * how many times, where the first of them ran. A reply that counted papers thirty-nine times ran
 * thirty-nine cards down the page, one that saved fifty-nine papers one at a time ran fifty-nine,
 * each with its own Undo, and one that read three PDFs ran three. opencode folds a run of reads
 * into one row the same way (its context tool group). The card undoes the whole run, and each of
 * its lines its own step. The calls that failed are a card of their own, beside the ones that worked.
 */
export function runsOf<S extends CardStep>(steps: S[]): S[][] {
  return grouped(steps, (step) => {
    if (!folds(step)) return null;
    const { kind, words } = viewOf(step.action, step.variant);
    return `${kind}:${words}:${step.status === "failed" ? "failed" : "ran"}`;
  });
}

/**
 * The calls a reply waits on the person for, as their approval cards: the calls of one action it
 * asked about together are one card, with one answer for all of them. Five PDFs read at once ask
 * once, with what the five cost. A bulk change is one card already.
 */
export const askedGroups = <S extends CardStep>(steps: S[]): S[][] =>
  grouped(steps, (step) => (step.batch === undefined ? `${step.action}#${step.variant ?? ""}#${step.credits === undefined ? "free" : "spends"}` : null));

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

/**
 * Why a step asks first, as the sentence its card gives (messages `assistant.asks`): it changes
 * many records at once; other people see a change that can be undone; other people see one
 * that can't; or it can't be undone. `undoable` only says so beside `outside` (convex/assistant/tools.ts).
 */
export const whyAsked = (step: { batch?: number; outside?: true; undoable?: true }) =>
  step.batch !== undefined ? "whyMany" : !step.outside ? "whyUndo" : step.undoable ? "whyShown" : "whyOutside";
