// The action registry's gate. The assistant can do everything a user can, so every
// public Convex function and Next.js server action must be built from a registry entry
// (convex/lib/userActions.ts) or listed in scripts/user-actions-exempt.json: under
// "plumbing" with the reason it isn't a user action, or under "pending" with the issue
// that will register it.
//
// Convex functions are read at runtime, from what each module actually exports, so
// re-exports, default exports and factories are all seen. Server actions are read from
// source, since their modules only load inside Next.js. Run with `npm run check:user-actions`;
// `-- --list` prints what is neither registered nor listed.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { USER_ACTIONS } from "../convex/lib/userActionRegistry";
import { assistantPath } from "../convex/lib/userActions";

type ConvexFunction = { isPublic?: boolean; isInternal?: boolean; isQuery?: boolean; isMutation?: boolean; isAction?: boolean; userActionPath?: string };

function files(dir: string, keep: (file: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return ["_generated", "node_modules", ".next", ".git"].includes(entry.name) ? [] : files(file, keep);
    return keep(file) ? [file] : [];
  });
}

const problems: string[] = [];
const raw = new Set<string>();
const registered = new Map<string, string>(); // public function ID → the entry path it was built from
const twins = new Map<string, string>(); // entry path → its internal twin's ID

// Convex: import every module and read what it exports.
const convexModules = files("convex", (f) => /\.(ts|js)$/.test(f) && !/\.test\.|\.test-support\./.test(f) && f !== "convex/convex.config.ts");
for (const file of convexModules) {
  const module = file.slice("convex/".length).replace(/\.(ts|js)$/, "");
  const exports = (await import(path.resolve(file))) as Record<string, ConvexFunction>;
  for (const [name, fn] of Object.entries(exports)) {
    if (!fn || !(fn.isQuery || fn.isMutation || fn.isAction)) continue;
    const id = `${module}:${name}`;
    if (fn.isPublic) {
      if (fn.userActionPath) registered.set(id, fn.userActionPath);
      else raw.add(id);
    } else if (fn.userActionPath && name.endsWith("ForAssistant")) twins.set(fn.userActionPath, id);
  }
}

// Every public function built from an entry is in the list the assistant's tools come from,
// and every listed entry has its public function and its internal twin.
const listed = new Set(USER_ACTIONS.map((entry) => entry.path));
for (const [id, entryPath] of registered) if (!listed.has(entryPath)) problems.push(`${id}: add its entry (${entryPath}) to USER_ACTIONS in convex/lib/userActionRegistry.ts.`);
for (const entry of USER_ACTIONS) {
  if (!registered.has(entry.path)) problems.push(`${entry.path}: in USER_ACTIONS, but no public function is exported at that path from its entry.`);
  if (twins.get(entry.path) !== assistantPath(entry.path)) problems.push(`${entry.path}: export ${assistantPath(entry.path).split(":")[1]} (assistantQuery or assistantMutation of the same entry) for the assistant's tool.`);
}

// Next.js server actions, from source.
const isUseServer = (statement: ts.Statement) => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === "use server";
/** The directive prologue: the string-literal statements a module or function body starts with. */
function prologue(statements: ts.NodeArray<ts.Statement>) {
  const found: ts.Statement[] = [];
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    found.push(statement);
  }
  return found;
}
const sources = files(".", (f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !/\.test\.|\.spec\.|\.d\.ts$/.test(f) && !f.startsWith("convex/") && !f.startsWith("scripts/") && !f.startsWith("e2e/"));
for (const file of sources) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("use server")) continue;
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const module = file.replace(/\.(ts|tsx|js|jsx|mjs)$/, "");
  // A function that declares "use server" in its own body is an inline server action.
  const visit = (node: ts.Node) => {
    const body = (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) && node.body && ts.isBlock(node.body) ? node.body : null;
    if (body && prologue(body.statements).some(isUseServer)) {
      const { line } = tree.getLineAndCharacterOfPosition(node.getStart());
      problems.push(`${file}:${line + 1}: inline server action. Move it into a "use server" module so the gate can see it.`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!prologue(tree.statements).some(isUseServer)) continue;
  for (const statement of tree.statements) {
    const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(statement) && exported) raw.add(`${module}:${isDefault || !statement.name ? "default" : statement.name.text}`);
    else if (ts.isVariableStatement(statement) && exported) for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) raw.add(`${module}:${decl.name.text}`);
    }
    else if (ts.isExportAssignment(statement)) raw.add(`${module}:default`);
    else if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || statement.moduleSpecifier) problems.push(`${file}: re-exports from a "use server" module. Export each action from where it is defined.`);
      else if (ts.isNamedExports(statement.exportClause)) for (const element of statement.exportClause.elements) raw.add(`${module}:${element.name.text}`);
    }
  }
}

const exempt = JSON.parse(readFileSync("scripts/user-actions-exempt.json", "utf8")) as { plumbing: Record<string, string>; pending: Record<string, string> };
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
  if (reason.trim().length < 10) problems.push(`${id}: plumbing needs its reason.`);
}
for (const [id, issue] of pending) {
  if (!raw.has(id)) problems.push(`${id}: listed as pending but no longer exists or is registered now; remove it.`);
  if (!/^#\d+$/.test(issue)) problems.push(`${id}: pending needs the issue that will register it, such as "#327".`);
}

if (problems.length) {
  console.error(`User action registry: ${problems.length} problem${problems.length === 1 ? "" : "s"}.\n\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`User action registry: ${listed.size} registered, ${pending.size} pending, ${plumbing.size} plumbing.`);
