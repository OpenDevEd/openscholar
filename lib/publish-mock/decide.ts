// MOCK (mock/publish-reports): a decision model asked on behalf of a report's checks.
import { DecisionsError, decideYesNo } from "@/lib/ai/decisions";

/**
 * A decision model's answers, asked again when it says it's busy. Drex Max answers 429 "Model busy, retry later"
 * now and then: on 2026-11-10 it did so in two of four runs of a report's checks, and a check that can't answer
 * holds the report for a reviewer. Three tries, a second and then three seconds apart.
 */
export async function decide(args: Parameters<typeof decideYesNo>[0]) {
  for (const wait of [1000, 3000]) {
    try {
      return await decideYesNo(args);
    } catch (error) {
      if (!(error instanceof DecisionsError) || error.status !== 429) throw error;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  return decideYesNo(args);
}
