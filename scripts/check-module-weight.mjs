#!/usr/bin/env node

// Every call to a Convex query or mutation first loads the function's module with everything
// it imports, so a module pays for its heaviest import on every call. Measured on the e2e
// backend on 2026-10-10: an empty query costs 5 ms from a module that imports nothing, and
// 42 ms from one that reaches the assistant's agent (the AI SDK, zod and the OpenRouter
// provider, about 2 MB of code). Forty such calls at once took 269 ms against 14 ms.
//
// So a module may load a heavy package only when its own work needs it:
// - the assistant's agent (the AI SDK, zod and the OpenRouter provider, about 2 MB) only in the modules that run the assistant.
//   Everything else reaches it through `internal.assistant.*` references, which load nothing, and reads shared constants
//   from `lib/assistant/`.
// - the generated validator for a community's configuration (about 4 MB) only in the modules that validate or migrate a
//   configuration. On 2026-11-10 it was in 85 of 435 modules, `http.ts` among them, through a constant or an error class
//   that lived beside it: each community record Openscholar received spent about 85 ms of its 125 ms loading it.
// - zod (about 730 KB) never in the modules the app's pages call: screening, sharing, the library, accounts, billing,
//   organizations, paper sets and extraction.
// This fails on any other module one comes into, and prints the imports that bring it there.
//
// Node actions ("use node") are left out: their runtime keeps modules loaded between calls.

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
// The bundler Convex deploys with, so this measures what the backend loads.
const { build } = require(require.resolve("esbuild", { paths: [path.dirname(require.resolve("convex/package.json"))] }));

/** Heavy packages, with the modules that may load each and what to do instead. */
const HEAVY = [
  {
    name: "@convex-dev/agent",
    loads: (file) => file.includes("node_modules/@convex-dev/agent/"),
    mayLoad: [
      /^convex\/assistant\//,
      // Mounts every HTTP route, the assistant's among them.
      /^convex\/http\.ts$/,
      // Lists every action the assistant can run, with the replies that run them.
      /^convex\/lib\/userActionRegistry\.ts$/,
      // Clears a deleted account's chats and their files.
      /^convex\/maintenance\/mutations\.ts$/,
      // Reads a paper's PDF into a chat.
      /^convex\/research\/papers\.ts$/,
    ],
    instead: "Call the assistant through an `internal.assistant.*` reference (ctx.runMutation, ctx.runQuery or the scheduler), and move a shared constant or type to lib/assistant/.",
  },
  {
    // About 730 KB, measured 2026-11-28: it came into every module through the schema (a list of DOCiD's funder types
    // whose module built zod schemas), and into every screening module through one constant beside the community client.
    // Taking it out halved the median module, from 1.3 MB to 610 KB. Code that checks a reply from another service
    // (the assistant, reports, communities) still needs it; the modules the app's pages call on every load don't.
    name: "zod",
    loads: (file) => file.includes("node_modules/zod/"),
    mayLoad: [/^convex\/(?!(screening|sharing|library|users|billing|organizations|paperSets|extraction)\/)/],
    instead: "Import the constant or type from a module that builds no zod schema, or move it to one (as LIBRARY_CHANGE_MAX moved to lib/evidence-libraries/reader-sources.ts).",
  },
  {
    name: "the community configuration validator",
    loads: (file) => file.endsWith("configuration/generated/library-config.validator.cjs"),
    mayLoad: [
      // The assistant edits a community's configuration, and every module it runs from loads its actions.
      /^convex\/assistant\//,
      /^convex\/lib\/userActionRegistry\.ts$/,
      /^convex\/maintenance\/mutations\.ts$/,
      // Validate, migrate or publish a configuration, or read one migrated to the current version.
      /^convex\/evidenceLibraries\/(addressRecovery|applicationSetup|applications|assistant|configurationDeployment|configurationMigration|configurationSnapshot|databaseSetup|deploymentSetup|directory|mutations|operations|queries|readinessSetup|releases|revisionConfiguration|setupNaming|setupOperation|storageSetup|versions)\.ts$/,
      /^convex\/migrations\/(communityDirectory|versionChangedSections)\.ts$/,
    ],
    instead: "Import a constant, type or error class from a module that doesn't load the validator (such as owner-configuration-version.ts, assembly-error.ts, publication-settings.ts or convex/evidenceLibraries/operationState.ts), or move it to one.",
  },
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

/** The shortest chain of imports from a module to a file `loads` matches, or undefined when it reaches none. */
function chainTo(entry, loads) {
  const from = new Map([[entry, undefined]]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (loads(file)) {
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

const problems = HEAVY.flatMap(({ name, loads, mayLoad, instead }) => {
  const found = modules
    .filter((file) => !mayLoad.some((allowed) => allowed.test(file)))
    .flatMap((file) => {
      const chain = chainTo(file, loads);
      return chain ? [`${file} loads ${name}:\n    ${chain.map((step) => step.replace(/^node_modules\//, "")).join("\n    -> ")}`] : [];
    });
  return found.length ? [`${found.join("\n\n")}\n\n${found.length} module${found.length === 1 ? "" : "s"} load ${name}, which slows every call to them. ${instead}`] : [];
});

if (problems.length) {
  console.error(problems.join("\n\n"));
  process.exit(1);
}
console.log(`Module weight: ${modules.length} modules checked; heavy packages load only where they're used.`);
