import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/live-billing/**/*.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
