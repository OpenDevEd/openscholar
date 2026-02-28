import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
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
    ],
    server: {
      deps: {
        // Required for convex-test's dynamic module loading
        inline: ["convex-test"],
      },
    },
    include: ["tests/**/*.test.ts", "convex/**/*.test.ts"],
    exclude: ["tests/live-billing/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
