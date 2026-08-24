#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";

const envPath = path.resolve(".env.local");

let fileEnv;
try {
  fileEnv = parseEnv(readFileSync(envPath, "utf8"));
} catch (error) {
  console.error(`Could not read ${envPath}. Copy the approved dev-self environment first.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const requiredValues = {
  CONVEX_SELF_HOSTED_URL: "https://convex.opendev.space",
  NEXT_PUBLIC_CONVEX_URL: "https://convex.opendev.space",
  NEXT_PUBLIC_CONVEX_SITE_URL: "https://convex-site.opendev.space",
};

for (const [key, expected] of Object.entries(requiredValues)) {
  if (fileEnv[key] !== expected) {
    console.error(`${key} must be ${expected}. Refusing to start a different Convex deployment.`);
    process.exit(1);
  }
}

if (!fileEnv.CONVEX_SELF_HOSTED_ADMIN_KEY?.startsWith("openscholar-dev|")) {
  console.error("CONVEX_SELF_HOSTED_ADMIN_KEY must target the openscholar-dev deployment.");
  process.exit(1);
}

const mode = process.argv[2];
const extraArgs = process.argv.slice(3);
const convexBin = path.resolve(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "convex.cmd" : "convex",
);

let args;
if (mode === "dev") {
  args = [
    "dev",
    "--env-file",
    envPath,
    "--tail-logs",
    "always",
    "--start",
    "next dev",
    ...extraArgs,
  ];
} else if (mode === "push") {
  args = ["dev", "--once", "--env-file", envPath, "--tail-logs", "disable", ...extraArgs];
} else if (mode === "logs") {
  args = ["logs", "--history", "20", ...extraArgs];
} else {
  console.error("Usage: run-remote-convex.mjs <dev|push|logs> [Convex options]");
  process.exit(1);
}

const child = spawn(convexBin, args, {
  env: { ...process.env, ...fileEnv },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Could not start the Convex CLI: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
