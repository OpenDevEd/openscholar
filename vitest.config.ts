import { defineConfig } from "vitest/config";
import path from "path";

const domTests = [
  "tests/hooks/**/*.test.{ts,tsx}",
  "tests/components/**/*.test.tsx",
  "tests/a11y/**/*.test.tsx",
  "app/**/__tests__/**/*.test.tsx",
  "tests/*.test.tsx",
];
// The largest sizes the product allows (#350): over half of the suite's time, so CI runs them
// only when a change can reach Convex code.
const limitTests = ["convex/limits/**/*.test.ts"];

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, ".") },
      // Every Convex test runs under Convex's transaction limits (#350).
      { find: /^convex-test$/, replacement: path.resolve(__dirname, "tests/convex-test-with-limits.ts") },
    ],
  },
  test: {
    projects: [
      { test: { name: "convex", environment: "edge-runtime", include: ["convex/**/*.test.ts"], exclude: limitTests } },
      { test: { name: "limits", environment: "edge-runtime", include: limitTests } },
      { test: { name: "dom", environment: "jsdom", include: domTests } },
      { test: { name: "node", environment: "node", include: ["tests/**/*.test.{ts,tsx}", "lib/**/*.test.ts"], exclude: [...domTests, "tests/live-billing/**"] } },
      // What functions read at full size (#631): `npm run bench` only, never in `npm test`, since it seeds jobs of 50,000 papers.
      ...(process.env.BENCH ? [{ test: { name: "bench", environment: "edge-runtime", include: ["convex/bench/**/*.bench.ts"], testTimeout: 1_800_000, hookTimeout: 1_800_000, fileParallelism: false } }] : []),
    ],
    server: {
      deps: {
        // Required for convex-test's dynamic module loading
        inline: ["convex-test"],
      },
    },
    setupFiles: ["./tests/setup.ts"],
    // CI runs these beside three Next.js builds on the same machine. A jsdom
    // test that takes a second or two alone, such as rendering 950 bucket
    // rows, then ran past Vitest's default of five seconds.
    testTimeout: 15_000,
  },
});
