/**
 * Pure tri-state classifier for chat-text citation pills.
 *
 * `classifyCitationState` maps a resolved-paper shape (or `null`) to one
 * of four render states. The component's job is just to apply the
 * resulting state via `data-citation-state`; every behavioral contract
 * downstream (pill chrome, hover-card actions, tests) pivots on that
 * attribute rather than on component internals.
 *
 * Lives next to `resolve-paper.ts` because both operate on the same
 * `ResolvablePaper` shape — the resolver parses text into papers,
 * this classifier turns a paper into a render state.
 */

export type CitationState =
  | "included"
  | "excluded"
  | "unresolved"
  | "deprecated";

export type CitationResolvable = { included: boolean };

export function classifyCitationState(
  paper: CitationResolvable | null,
  opts: { deprecated?: boolean } = {},
): CitationState {
  if (opts.deprecated) return "deprecated";
  if (paper === null) return "unresolved";
  return paper.included ? "included" : "excluded";
}
