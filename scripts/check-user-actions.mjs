#!/usr/bin/env node

// The action registry's gate. The assistant can do everything a user can, so every
// public Convex function and Next.js server action must be built from a registry
// entry (convex/lib/userActions.ts) or listed in scripts/user-actions-exempt.json:
// under "plumbing" with the reason it isn't a user action, or under "pending" with
// the issue that will register it. `--list` prints what is neither.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const PUBLIC = new Set(["query", "mutation", "action", "createAIAction"]);
const REGISTERED = new Set(["userQuery", "accountQuery", "userMutation", "accountMutation"]);
const ASSISTANT = new Set(["assistantQuery", "assistantMutation"]);
const DEFINE = new Set(["defineUserQuery", "defineUserMutation"]);
const REGISTRY = "convex/lib/userActionRegistry.ts";

function files(dir, keep) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "_generated" || entry.name === "node_modules" ? [] : files(file, keep);
    return keep(file) ? [file] : [];
  });
}

const source = (file) => ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
const callee = (node) => (ts.isCallExpression(node) && ts.isIdentifier(node.expression) ? node.expression.text : null);
const exported = (statement) => ts.isVariableStatement(statement) && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const problems = [];
const raw = new Set();
const registered = [];

// Convex: plain public functions, and functions built from registry entries.
for (const file of files("convex", (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".test-support.ts"))) {
  const module = file.slice("convex/".length, -".ts".length);
  const tree = source(file);
  const exports = new Map();
  const paths = new Map();
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const fn = callee(decl.initializer);
      if (fn && DEFINE.has(fn)) {
        const entry = decl.initializer.arguments[0];
        const prop = ts.isObjectLiteralExpression(entry) && entry.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(tree) === "path");
        if (prop && ts.isStringLiteral(prop.initializer)) paths.set(decl.name.text, prop.initializer.text);
      }
      if (!exported(statement) || !fn) continue;
      const argument = decl.initializer.arguments[0];
      exports.set(decl.name.text, { fn, entry: argument && ts.isIdentifier(argument) ? argument.text : null });
    }
  }
  for (const [name, { fn, entry }] of exports) {
    const id = `${module}:${name}`;
    if (PUBLIC.has(fn)) raw.add(id);
    if (!REGISTERED.has(fn)) continue;
    registered.push({ id, entry });
    if (paths.get(entry) !== id) problems.push(`${id}: its entry ${entry} must be defined in this file with path "${id}".`);
    const twin = exports.get(`${name}ForAssistant`);
    if (!twin || !ASSISTANT.has(twin.fn) || twin.entry !== entry) problems.push(`${id}: export ${name}ForAssistant = assistant${fn.endsWith("Query") ? "Query" : "Mutation"}(${entry}) for the assistant's tool.`);
  }
}

// Every entry built into a public function is in the list the assistant's tools come from.
const registry = readFileSync(REGISTRY, "utf8");
const listed = new Set(registry.slice(registry.indexOf("USER_ACTIONS")).match(/\b\w+Action\b/g) ?? []);
for (const { id, entry } of registered) if (!listed.has(entry)) problems.push(`${id}: add ${entry} to USER_ACTIONS in ${REGISTRY}.`);

// Next.js server actions: exported functions in "use server" files.
for (const file of files(".", (f) => /\.(ts|tsx)$/.test(f) && !f.includes("/.") && !f.startsWith("convex/") && !/\.test\.tsx?$/.test(f))) {
  const tree = source(file);
  const first = tree.statements[0];
  if (!first || !ts.isExpressionStatement(first) || !ts.isStringLiteral(first.expression) || first.expression.text !== "use server") continue;
  const module = file.replace(/\.tsx?$/, "");
  for (const statement of tree.statements) {
    const isExported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) raw.add(`${module}:${statement.name.text}`);
    if (ts.isVariableStatement(statement)) for (const decl of statement.declarationList.declarations) if (ts.isIdentifier(decl.name)) raw.add(`${module}:${decl.name.text}`);
  }
}

const exempt = JSON.parse(readFileSync("scripts/user-actions-exempt.json", "utf8"));
const plumbing = new Map(Object.entries(exempt.plumbing));
const pending = new Map(Object.entries(exempt.pending));

const unlisted = [...raw].filter((id) => !plumbing.has(id) && !pending.has(id)).sort();
if (process.argv.includes("--list")) {
  console.log(unlisted.join("\n"));
  process.exit(0);
}
for (const id of unlisted) problems.push(`${id}: register it (convex/lib/userActions.ts), or list it in scripts/user-actions-exempt.json.`);
for (const [id, reason] of plumbing) {
  if (!raw.has(id)) problems.push(`${id}: listed as plumbing but no longer exists; remove it.`);
  if (typeof reason !== "string" || reason.trim().length < 10) problems.push(`${id}: plumbing needs its reason.`);
}
for (const [id, issue] of pending) {
  if (!raw.has(id)) problems.push(`${id}: listed as pending but no longer exists or is registered now; remove it.`);
  if (!/^#\d+$/.test(issue)) problems.push(`${id}: pending needs the issue that will register it, such as "#327".`);
}

if (problems.length) {
  console.error(`User action registry: ${problems.length} problem${problems.length === 1 ? "" : "s"}.\n\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`User action registry: ${registered.length} registered, ${pending.size} pending, ${plumbing.size} plumbing.`);
