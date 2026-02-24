import { defineConfig } from "@playwright/test";
import path from "node:path";
import { accessSync, constants } from "node:fs";

function loadEnvironmentFromFiles(): void {
  const loadEnvFile = (process as typeof process & {
    loadEnvFile?: (file?: string) => void;
  }).loadEnvFile;

  if (typeof loadEnvFile !== "function") {
    return;
  }

  for (const envFile of [".env.local", ".env"]) {
    const absolutePath = path.resolve(process.cwd(), envFile);
    try {
      accessSync(absolutePath, constants.F_OK);
      loadEnvFile(absolutePath);
    } catch {
      // Ignore missing env files in CI/workflows that rely on injected env vars.
    }
  }
}

loadEnvironmentFromFiles();
if (
  !process.env.CLERK_PUBLISHABLE_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
) {
  process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const defaultWebServerCommand = "npm run build && npm run start -- --port 3000";
const webServerCommand =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? defaultWebServerCommand;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global.setup.ts",
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 300_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
