#!/usr/bin/env node

// Every call to a Convex query or mutation first loads the function's module with everything
// it imports, so a module pays for its heaviest import on every call. Measured on the e2e
// backend on 2026-10-10: an empty query costs 5 ms from a module that imports nothing, and
// 42 ms from one that reaches the assistant's agent (the AI SDK, zod and the OpenRouter
// provider, about 2 MB of code). Forty such calls at once took 269 ms against 14 ms.
//
// So only the modules that run the assistant may load the agent. Everything else reaches
// the assistant through `internal.assistant.*` references, which load nothing, and reads
// shared constants from `lib/assistant/`. This fails on any other module the agent comes
// into, and prints the imports that bring it there.
//
// Node actions ("use node") are left out: their runtime keeps modules loaded between calls.

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
// The bundler Convex deploys with, so this measures what the backend loads.
const { build } = require(require.resolve("esbuild", { paths: [path.dirname(require.resolve("convex/package.json"))] }));

/** What a module loads only to run the assistant. It brings the AI SDK and zod with it. */
const HEAVY = ["@convex-dev/agent"];
/** Modules that run the assistant, or hold everything by design. */
const MAY_LOAD = [
  /^convex\/assistant\//,
  // Mounts every HTTP route, the assistant's among them.
  /^convex\/http\.ts$/,
  // Lists every action the assistant can run, with the replies that run them.
  /^convex\/lib\/userActionRegistry\.ts$/,
  // Clears a deleted account's chats and their files.
  /^convex\/maintenance\/mutations\.ts$/,
  // Reads a paper's PDF into a chat.
  /^convex\/research\/papers\.ts$/,
];

const modules = readdirSync(path.join(root, "convex"), { recursive: true })
  .map((file) => path.posix.join("convex", file.split(path.sep).join("/")))
  // Every extension Convex deploys as a module.
  .filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !/\.d\.[cm]?ts$/.test(file) && !file.includes("/_generated/") && !/\.test(-support)?\.[cm]?[jt]sx?$/.test(file) && !/convex\.config\.[cm]?[jt]s$/.test(file))
  .filter((file) => !/^\s*["']use node["']/m.test(readFileSync(path.join(root, file), "utf8").slice(0, 400)));

const { metafile } = await build({
  absWorkingDir: root,
  entryPoints: modules,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  conditions: ["convex", "module"],
  // As Convex bundles for a deployment: an import behind a production check counts.
  define: { "process.env.NODE_ENV": '"production"' },
  // Test helpers a few modules import read files; nothing here runs.
  external: ["node:*"],
  outdir: "out",
  write: false,
  metafile: true,
  logLevel: "silent",
});

const heavy = (file) => HEAVY.find((name) => file.includes(`node_modules/${name}/`));

/** The shortest chain of imports from a module to a heavy package, or undefined when it reaches none. */
function chainTo(entry) {
  const from = new Map([[entry, undefined]]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (heavy(file)) {
      const chain = [];
      for (let at = file; at; at = from.get(at)) chain.unshift(at);
      return chain;
    }
    for (const { path: next } of metafile.inputs[file]?.imports ?? []) {
      if (!from.has(next) && metafile.inputs[next]) {
        from.set(next, file);
        queue.push(next);
      }
    }
  }
}

const problems = modules
  .filter((file) => !MAY_LOAD.some((allowed) => allowed.test(file)))
  .flatMap((file) => {
    const chain = chainTo(file);
    return chain ? [`${file} loads ${heavy(chain.at(-1))}:\n    ${chain.map((step) => step.replace(/^node_modules\//, "")).join("\n    -> ")}`] : [];
  });

if (problems.length) {
  console.error(problems.join("\n\n"));
  console.error(`\n${problems.length} module${problems.length === 1 ? "" : "s"} outside the assistant load its agent, which slows every call to them. Call the assistant through an \`internal.assistant.*\` reference (ctx.runMutation, ctx.runQuery or the scheduler), and move a shared constant or type to lib/assistant/.`);
  process.exit(1);
}
console.log(`Module weight: ${modules.length} modules checked; only the assistant's load its agent.`);
