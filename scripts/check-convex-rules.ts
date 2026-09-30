// Convex rules from the Convex reviewer (get-convex/agent-skills), checked in CI (#350):
//
// - Every read of a whole query result, `.collect()` or `for await` over `ctx.db.query(...)`,
//   is bounded or known. A bounded read is listed in scripts/convex-rules.json under
//   unboundedReads.bounded with why its rows stay few; one that can grow past Convex's
//   limits is listed under unboundedReads.pending with the issue that bounds it.
// - Every public function (`query`, `mutation`, `action`) has a `returns` validator,
//   unless listed under missingReturns.pending with its issue.
// - No public query reads the clock: `Date.now()` in a query breaks its caching and
//   reactivity. Schedule a change instead, or pass the time in.
//
// Reads are keyed by file, enclosing function and table, so edits elsewhere don't move them.
// Run with `npm run check:convex-rules`; `-- --list` prints every read's key, `-- --list --verbose` its query too.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "_generated" ? [] : files(file);
    return /\.ts$/.test(file) && !/\.test\.|\.test-support\.|\.d\.ts$/.test(file) ? [file] : [];
  });
}

/** The name of the nearest named function or variable holding `node`. */
function enclosingName(node: ts.Node): string {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) return current.name.getText();
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    // `handler` inside `export const name = query({ handler })` is named after the export.
    if (ts.isPropertyAssignment(current) && ts.isIdentifier(current.name) && current.name.text !== "handler" && ts.isFunctionLike(current.initializer)) return current.name.text;
  }
  return "(module)";
}

/** The table a query chain reads, from its `.query("table")` call. */
function tableOf(expression: ts.Expression): string {
  let current: ts.Node = expression;
  while (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current) || ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) {
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) && current.expression.name.text === "query" && current.arguments[0] && ts.isStringLiteral(current.arguments[0])) return current.arguments[0].text;
    current = ts.isCallExpression(current) ? current.expression : ts.isPropertyAccessExpression(current) ? current.expression : (current as ts.AwaitExpression | ts.ParenthesizedExpression).expression;
  }
  return "?";
}

/** The initializer of `const name = ...` in the file, when it builds a query. */
function declaredQuery(tree: ts.SourceFile, name: string): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer && /\.query\(/.test(node.initializer.getText())) found = node.initializer;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/** `export const name = query({...})`, `mutation({...})` or `action({...})`: a public function defined in place. */
function publicFunction(node: ts.Node) {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer || !ts.isCallExpression(node.initializer)) return null;
  const call = node.initializer;
  const kind = ts.isIdentifier(call.expression) ? call.expression.text : "";
  if (!["query", "mutation", "action"].includes(kind) || !call.arguments[0] || !ts.isObjectLiteralExpression(call.arguments[0])) return null;
  return { name: node.name.text, kind, definition: call.arguments[0] };
}

const reads: string[] = [];
const missingReturns: string[] = [];
const clockReads: string[] = [];
for (const file of files("convex")) {
  const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const seen = new Map<string, number>();
  const add = (node: ts.Node, table: string) => {
    const base = `${file}:${enclosingName(node)}:${table}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    reads.push(count === 1 ? base : `${base}#${count}`);
    if (process.argv.includes("--verbose")) console.log(reads.at(-1), "=>", node.getText().replace(/\s+/g, " ").slice(0, 170));
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "collect" && node.arguments.length === 0) {
      add(node, tableOf(node.expression.expression));
    }
    if (ts.isForOfStatement(node) && node.awaitModifier) {
      // A loop over a variable reads the query the variable was set to.
      const source = ts.isIdentifier(node.expression) ? declaredQuery(tree, node.expression.text) ?? node.expression : node.expression;
      if (/\.query\(/.test(source.getText())) add(node, tableOf(source));
    }
    const fn = publicFunction(node);
    if (fn) {
      const properties = new Set(fn.definition.properties.map((p) => (p.name && ts.isIdentifier(p.name) ? p.name.text : "")));
      if (!properties.has("returns")) missingReturns.push(`${file}:${fn.name}`);
      if (fn.kind === "query" && /\bDate\.now\(\)/.test(fn.definition.getText())) clockReads.push(`${file}:${fn.name}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}

if (process.argv.includes("--list")) {
  console.log(reads.join("\n"));
  process.exit(0);
}

type Listed = { bounded: Record<string, string>; pending: Record<string, string> };
const rules = JSON.parse(readFileSync("scripts/convex-rules.json", "utf8")) as { unboundedReads: Listed; missingReturns: { pending: Record<string, string> } };
const problems: string[] = [];
const issue = /^#\d+$/;

const found = new Set(reads);
const { bounded, pending } = rules.unboundedReads;
for (const read of reads) {
  if (!(read in bounded) && !(read in pending)) problems.push(`${read}: bound it with .take(n) or .paginate(), or list it in scripts/convex-rules.json with why its rows stay few.`);
}
for (const [read, reason] of Object.entries(bounded)) {
  if (!found.has(read)) problems.push(`${read}: listed as bounded but no longer read this way; remove it.`);
  if (reason.trim().length < 15) problems.push(`${read}: say why its rows stay few.`);
}
for (const [read, ref] of Object.entries(pending)) {
  if (!found.has(read)) problems.push(`${read}: listed as pending but no longer read this way; remove it.`);
  if (!issue.test(ref)) problems.push(`${read}: pending needs the issue that bounds it, such as "#351".`);
}

const withoutReturns = new Set(missingReturns);
for (const fn of missingReturns) if (!(fn in rules.missingReturns.pending)) problems.push(`${fn}: add a \`returns\` validator.`);
for (const [fn, ref] of Object.entries(rules.missingReturns.pending)) {
  if (!withoutReturns.has(fn)) problems.push(`${fn}: listed as missing returns but has one now; remove it.`);
  if (!issue.test(ref)) problems.push(`${fn}: pending needs the issue that adds its validator.`);
}

for (const fn of clockReads) problems.push(`${fn}: a query can't read the clock; schedule the change or pass the time in.`);

if (problems.length) {
  console.error(`Convex rules: ${problems.length} problem${problems.length === 1 ? "" : "s"}.\n\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`Convex rules: ${Object.keys(bounded).length} whole-result reads bounded with a reason, ${Object.keys(pending).length} pending; ${Object.keys(rules.missingReturns.pending).length} functions waiting on a returns validator.`);
