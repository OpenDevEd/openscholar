import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, ".") },
      // Every Convex test runs under Convex's transaction limits (#350).
      { find: /^convex-test$/, replacement: path.resolve(__dirname, "tests/convex-test-with-limits.ts") },
    ],
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [
      // Convex function tests need edge-runtime (convex-test requirement)
      ["convex/**/*.test.ts", "edge-runtime"],
      // React hook/component tests need jsdom for DOM APIs
      ["tests/hooks/**/*.test.ts", "jsdom"],
      ["tests/hooks/**/*.test.tsx", "jsdom"],
      ["tests/components/**/*.test.tsx", "jsdom"],
      ["tests/a11y/**/*.test.tsx", "jsdom"],
      ["app/**/__tests__/**/*.test.tsx", "jsdom"],
      // tsx test files at tests root level use jsdom
      ["tests/*.test.tsx", "jsdom"],
    ],
    server: {
      deps: {
        // Required for convex-test's dynamic module loading
        inline: ["convex-test"],
      },
    },
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "convex/**/*.test.ts",
      "lib/**/*.test.ts",
      "app/**/__tests__/**/*.test.tsx",
    ],
    exclude: ["tests/live-billing/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // CI runs these beside three Next.js builds on the same machine. A jsdom
    // test that takes a second or two alone, such as rendering 950 bucket
    // rows, then ran past Vitest's default of five seconds.
    testTimeout: 15_000,
  },
});
