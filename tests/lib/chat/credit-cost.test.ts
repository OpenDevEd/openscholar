/**
 * Chat's usageHandler wires the Agent component into the same credit
 * math extraction uses — calculateServerCreditsToDeduct. These tests
 * exercise the exact shapes Agent's usageHandler emits so we can
 * assert the cost math is unified across extraction and chat without
 * either side drifting.
 */
import { describe, expect, it } from "vitest";
import {
  calculateCreditsToDeductFromUsage,
} from "@/convex/ai/lib/creditBilling";
import { AI_COST_MARKUP } from "@/convex/lib/constants";

describe("chat usageHandler cost math (shared with extraction)", () => {
  it("correctly bills an Agent-shaped usage payload (inputTokens / outputTokens only)", () => {
    // Agent's v6 LanguageModelUsage populates `inputTokens` + `outputTokens`
    // (never the legacy `promptTokens` / `completionTokens`). The cost
    // helper reads the legacy names first, so a zero-fallthrough to
    // inputTokens must be safe — this test is the drift-detector for
    // when chat starts silently undercharging if that fallthrough
    // regresses.
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 20_000, outputTokens: 500 },
      pricing: { input: 3.0, output: 15.0 },
      markupMultiplier: AI_COST_MARKUP,
    });
    // 20k prompt + 500 output tokens at sonnet-ish rates is non-trivial;
    // anything in the low hundreds of credits proves the inputTokens
    // fallthrough is firing.
    expect(credits).toBeGreaterThanOrEqual(50);
  });

  it("returns 0 for empty usage + zero pricing (deterministic no-op)", () => {
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 0, outputTokens: 0 },
      pricing: { input: 0, output: 0 },
      markupMultiplier: AI_COST_MARKUP,
    });
    expect(credits).toBe(0);
  });

  it("rounds up at least 1 credit when usage is non-zero but pricing isn't synced yet", () => {
    // At module-sync time a brand-new model can land with zero pricing
    // until the OpenRouter sync cron runs. usageHandler should still
    // deduct a minimum credit so usage isn't free.
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 5_000, outputTokens: 200 },
      pricing: { input: 0, output: 0 },
      markupMultiplier: AI_COST_MARKUP,
    });
    expect(credits).toBe(1);
  });

  it("does not discount cache-read tokens (V1 has no prompt caching)", () => {
    // The chat path explicitly leaves cacheReadTokens unused in V1 —
    // see plan §4i. The helper's current contract treats the usage
    // shape {input,output} only, so passing 'cachedInputTokens' on
    // the usage object MUST NOT affect the output.
    const base = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 20_000, outputTokens: 500 },
      pricing: { input: 3.0, output: 15.0 },
      markupMultiplier: AI_COST_MARKUP,
    });
    const withCacheFieldNoise = calculateCreditsToDeductFromUsage({
      usage: {
        inputTokens: 20_000,
        outputTokens: 500,
        // This field doesn't exist on the Usage interface the helper
        // reads, so it's silently ignored — the test confirms that
        // assumption holds (drift-detector if cache discounting lands).
        cachedInputTokens: 19_500,
      } as unknown as {
        inputTokens: number;
        outputTokens: number;
      },
      pricing: { input: 3.0, output: 15.0 },
      markupMultiplier: AI_COST_MARKUP,
    });
    expect(withCacheFieldNoise).toBe(base);
  });

  it("scales linearly with outputTokens (no tiered pricing)", () => {
    const small = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 0, outputTokens: 1_000 },
      pricing: { input: 0, output: 10.0 },
      markupMultiplier: 1,
    });
    const big = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 0, outputTokens: 10_000 },
      pricing: { input: 0, output: 10.0 },
      markupMultiplier: 1,
    });
    // 10× output, 10× price (modulo rounding to whole credits)
    expect(big).toBeGreaterThanOrEqual(small * 9);
    expect(big).toBeLessThanOrEqual(small * 11);
  });
});
