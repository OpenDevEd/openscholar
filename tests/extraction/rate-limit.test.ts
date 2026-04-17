import { describe, test, expect } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

/**
 * Runtime replacement for the old source-grep test. The previous version
 * read convex/lib/rateLimit.ts as a string and asserted the presence of
 * specific v.literal(...) entries in the `consume` internalMutation.
 * That test would have broken under the P3 plan's mutations split even
 * though nothing semantically changed.
 *
 * The behavioural contract (consume rejects unknown rate-limit names at
 * the validator layer, and accepts the defined ones) is now asserted
 * against the live Convex function instead of the source text.
 */

const VALID_NAMES = [
  "start-extraction",
  "api-key-save",
  "checkout-session",
  "wallet-generate",
  "wallet-connect",
] as const;

describe("rateLimit.consume argument validator", () => {
  test("rejects an unknown name with an ArgumentValidationError", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(internal.lib.rateLimit.consume, {
        name: "unknown-rate-limit" as never,
        key: "k",
      })
    ).rejects.toThrow(/Validator error|ArgumentValidationError/);
  });

  test.each(VALID_NAMES)(
    "accepts %s without a validator error",
    async (name) => {
      const t = convexTest(schema);
      // The call may still reject for rate-limit business reasons; only a
      // VALIDATOR error would mean the union literal was removed.
      try {
        await t.mutation(internal.lib.rateLimit.consume, { name, key: "k" });
      } catch (e) {
        expect(String((e as Error).message)).not.toMatch(
          /Validator error for value `name`|ArgumentValidationError.*name/
        );
      }
    }
  );
});
