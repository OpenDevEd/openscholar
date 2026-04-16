// eslint.config.mjs
// GAP-03: forbids literal 1000/200 in extraction UI to prevent per-tier-limit drift.
// See .planning/phases/105-polish-integration-e2e/ for rationale.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // GAP-03 rule -- scoped to extraction UI surface (per D-02)
  {
    files: [
      "components/extraction/**/*.{ts,tsx}",
      "app/extraction/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=1000]",
          message:
            "Literal '1000' is forbidden in extraction UI. Import MAX_EXTRACTION_PAPERS_PER_JOB or getExtractionLimit from 'convex/lib/queryBounds' (or use the reactive getExtractionLimit query) to route through EXTRACTION_LIMITS_BY_TIER.",
        },
        {
          selector: "Literal[value=200]",
          message:
            "Literal '200' is forbidden in extraction UI. Import MAX_EXTRACTION_PAPERS_PER_JOB or getExtractionLimit from 'convex/lib/queryBounds' (or use the reactive getExtractionLimit query) to route through EXTRACTION_LIMITS_BY_TIER.",
        },
      ],
    },
  },

  // Test-file exception -- a SECOND, more specific config object per D-03.
  // Flat config runs configs in order; the later, more-specific glob overrides the earlier rule.
  {
    files: [
      "components/extraction/**/*.test.{ts,tsx}",
      "app/extraction/**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
