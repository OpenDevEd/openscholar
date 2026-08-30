import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["tests/live-billing/**/*.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
