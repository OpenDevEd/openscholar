import { ESTIMATED_CREDITS_PER_PAPER } from "../lib/constants";

/**
 * What screening `papers` papers holds against an `available` balance, and how many papers
 * that balance covers: the hold a job takes when it starts. The Screen all dialog and the
 * assistant's approval card both show it.
 */
export function estimateScreening(papers: number, available: number) {
  return {
    credits: Math.ceil(Math.max(0, papers) * ESTIMATED_CREDITS_PER_PAPER),
    available,
    affordablePapers: Math.floor(available / ESTIMATED_CREDITS_PER_PAPER),
  };
}
