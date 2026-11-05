import posthog from "posthog-js";
import { BUILT_IN_LENSES } from "@/convex/research/overviewValidators";

/**
 * What people do with the AI overview on a results page (#967, #1070), signed in or out. Properties are numbers,
 * booleans and our own short codes; someone who hasn't accepted analytics sends only the numbers and booleans
 * (lib/analytics-without-consent.ts). What a run cost is the server's `$ai_generation`.
 */
type OverviewEvents = {
  /** An overview began: by itself as the card showed a lens, from Write overview, or from Write again or Try again. */
  overview_started: { signed_in: boolean; lens: string; trigger: "auto" | "write" | "again"; paid: boolean };
  /** A signed-out visitor's overview finished; a signed-in one's is the server's `$ai_generation`. */
  overview_written: { signed_in: false; lens: string; ms: number; counts: number; papers: number; chars: number };
  overview_failed: { signed_in: boolean; lens: string; reason: string };
  /** The day's allowance ran out: a signed-out visitor's, or a signed-in person's paid overviews. */
  overview_limit_reached: { signed_in: boolean; lens: string };
  overview_lens_switched: { signed_in: boolean; lens: string };
  overview_lens_saved: { shared: boolean; edited: boolean };
  overview_lens_removed: { mine: boolean };
  overview_folded: { signed_in: boolean; folded: boolean };
  overview_copied: { signed_in: boolean; lens: string };
  overview_citation_opened: { signed_in: boolean; from: "text" | "list" };
  /** A signed-out visitor was sent to sign in, from New lens or from Write overview once theirs ran out. */
  overview_sign_in_prompted: { from: "new_lens" | "write" };
  /** Turnstile asked a signed-out visitor to show they're a person, or couldn't decide. */
  overview_verification: { result: "interactive" | "failed" };
};

export function trackOverview<E extends keyof OverviewEvents>(event: E, properties: OverviewEvents[E]) {
  posthog.capture(event, properties);
}

/** The lens as analytics names it: a built-in lens's own ID, and "custom" for one someone wrote, whose ID is theirs. */
export const lensCode = (lens: { id: string }) => (BUILT_IN_LENSES.some((one) => one.id === lens.id) ? lens.id : "custom");
