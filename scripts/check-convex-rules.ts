// Convex rules from the Convex reviewer (get-convex/agent-skills), checked in CI (#350):
//
// - Every read of a whole query result, `.collect()` or `for await` over a database query,
//   is bounded or known. A bounded read is listed in scripts/convex-rules.json under
//   unboundedReads.bounded with why its rows stay few; one that can grow past Convex's
//   limits is listed under unboundedReads.pending with the issue that bounds it.
// - Every public function (`query`, `mutation`, `action`) is defined with an object that
//   has a `returns` validator, unless listed under missingReturns.pending with its issue.
// - No handler reads as many rows as its caller asks: a `.take(n)` whose `n` comes from the
//   function's arguments is clamped with `Math.min`, or listed under
//   argumentSizedTakes.bounded with why it stays small.
// - No public query reads the clock, in its handler or any function it calls:
//   `Date.now()` or `new Date()` in a query breaks its caching and reactivity. Schedule
//   the change instead, or pass the time in.
// - Every handler returns only fields its `returns` validator declares. TypeScript accepts
//   extra fields on any value that isn't a fresh object literal, such as a row with some
//   fields destructured away; the validator rejects them at runtime, so a new column on the
//   row breaks the function only when that column is set.
// - Mutations run through the database triggers (#351): `mutation` and `internalMutation`
//   come from convex/lib/functions.ts, never from `_generated/server`, and every
//   `new Migrations(...)` is given that `internalMutation`.
//
// It reads the code with TypeScript's type checker, so a loop over a helper that returns
// a query, a named handler and a helper in another file are all followed.
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

const sources = files("convex");
const config = ts.getParsedCommandLineOfConfigFile("tsconfig.json", {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const program = ts.createProgram(sources, { ...config?.options, noEmit: true });
const checker = program.getTypeChecker();
const relative = (file: string) => path.relative(process.cwd(), file);
const inProject = (file: string) => !file.includes("node_modules") && !file.endsWith(".d.ts");

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

/** The table a query chain reads, from its `.query("table")` call, following a variable that holds it. */
function tableOf(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) {
    const declaration = checker.getSymbolAtLocation(expression)?.declarations?.[0];
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return tableOf(declaration.initializer);
  }
  let current: ts.Node = expression;
  while (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current) || ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) {
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) && current.expression.name.text === "query" && current.arguments[0] && ts.isStringLiteral(current.arguments[0])) return current.arguments[0].text;
    current = ts.isCallExpression(current) ? current.expression : ts.isPropertyAccessExpression(current) ? current.expression : (current as ts.AwaitExpression | ts.ParenthesizedExpression).expression;
  }
  return "?";
}

/** Whether `node` is a Convex database query, by its type. */
function isDatabaseQuery(node: ts.Expression) {
  const name = checker.getTypeAtLocation(node).getSymbol()?.getName() ?? "";
  return ["Query", "OrderedQuery", "QueryInitializer"].includes(name);
}

/** The function a call or reference leads to, when it's defined in this repository. */
function declarationOf(node: ts.Node): ts.Node | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol?.declarations?.[0];
  if (!declaration || !inProject(declaration.getSourceFile().fileName)) return undefined;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer && ts.isFunctionLike(declaration.initializer)) return declaration.initializer;
  return ts.isFunctionLike(declaration) ? declaration : undefined;
}

/** Where `root`, or any function it calls, reads the clock. */
function clockRead(root: ts.Node): string | null {
  const seen = new Set<ts.Node>();
  const queue = [root];
  while (queue.length) {
    const current = queue.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    let found: string | null = null;
    const visit = (node: ts.Node) => {
      if (found) return;
      const isNow = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.getText() === "Date.now";
      const isNewDate = ts.isNewExpression(node) && node.expression.getText() === "Date" && !node.arguments?.length;
      if (isNow || isNewDate) {
        const { line } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
        found = `${relative(node.getSourceFile().fileName)}:${line + 1}`;
        return;
      }
      if (ts.isCallExpression(node)) {
        const target = declarationOf(ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression);
        if (target) queue.push(target);
      }
      ts.forEachChild(node, visit);
    };
    visit(current);
    if (found) return found;
  }
  return null;
}

const BUILDERS = ["query", "mutation", "action"];
const ALL_BUILDERS = [...BUILDERS, "internalQuery", "internalMutation", "internalAction"];
const argumentSizedTakes: string[] = [];

/** `.take(n)` calls in `handler` whose `n` comes from the handler's arguments and isn't clamped. */
function takesSizedByArguments(handler: ts.Node): ts.CallExpression[] {
  if (!ts.isFunctionLike(handler)) return [];
  const argsParameter = handler.parameters[1];
  if (!argsParameter) return [];
  const names = new Set<ts.Symbol>();
  const collect = (binding: ts.BindingName) => {
    if (ts.isIdentifier(binding)) { const symbol = checker.getSymbolAtLocation(binding); if (symbol) names.add(symbol); }
    else for (const element of binding.elements) if (ts.isBindingElement(element)) collect(element.name);
  };
  collect(argsParameter.name);
  const found: ts.CallExpression[] = [];
  const isClamped = (size: ts.Node) => ts.isCallExpression(size) && size.expression.getText() === "Math.min";
  const readsArguments = (expression: ts.Node) => {
    let reads = false;
    const scan = (part: ts.Node) => { if (ts.isIdentifier(part) && names.has(checker.getSymbolAtLocation(part)!)) reads = true; ts.forEachChild(part, scan); };
    scan(expression);
    return reads;
  };
  const visit = (node: ts.Node) => {
    // A local set from the arguments, and not clamped, carries them on.
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !isClamped(node.initializer) && readsArguments(node.initializer)) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) names.add(symbol);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "take" && node.arguments[0]) {
      const size = node.arguments[0];
      if (!isClamped(size) && readsArguments(size)) found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  if ("body" in handler && handler.body) visit(handler.body);
  return found;
}
const skipped = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter;
const nullish = ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void;
const members = (type: ts.Type) => (type.isUnion() ? type.types : [type]);
const parts = (type: ts.Type) => members(type).filter((t) => !(t.flags & nullish));
const isArrayLike = (type: ts.Type) => checker.isArrayType(type) || checker.isTupleType(type);
/** An object compared by its fields: not an id, array, function or buffer. */
const isRecordLike = (type: ts.Type): boolean =>
  type.isIntersection()
    ? type.types.every(isRecordLike)
    : !!(type.flags & ts.TypeFlags.Object) && !isArrayLike(type) && type.getCallSignatures().length === 0 && type.getSymbol()?.getName() !== "ArrayBuffer";
const stringIndex = (type: ts.Type) => checker.getIndexInfoOfType(type, ts.IndexKind.String)?.type;
/** The declared branches `part` fits, such as the one with its `status`; all of them if it fits none. */
const fitting = (part: ts.Type, candidates: ts.Type[]) => {
  const fits = candidates.filter((candidate) => checker.isTypeAssignableTo(part, candidate));
  return fits.length ? fits : candidates;
};
const fewest = (found: string[][]) => (found.length ? found.reduce((best, next) => (next.length < best.length ? next : best)) : []);

/** Paths of fields `actual` can hold that `declared` doesn't allow. */
function undeclaredFields(actual: ts.Type, declared: ts.Type, at: ts.Node, path: string, depth = 0): string[] {
  if (depth > 8 || actual.flags & skipped || declared.flags & skipped) return [];
  return parts(actual).flatMap((part) => {
    if (part.flags & skipped) return [];
    if (isArrayLike(part)) {
      // Every element of a tuple, against the element type of each array branch it fits.
      const elements = checker.getTypeArguments(part as ts.TypeReference);
      return fewest(fitting(part, parts(declared).filter(isArrayLike)).map((candidate) => {
        const target = checker.getTypeArguments(candidate as ts.TypeReference)[0];
        return elements.flatMap((element) => undeclaredFields(element, target, at, `${path}[]`, depth + 1));
      }));
    }
    if (!isRecordLike(part)) return [];
    const dynamic = stringIndex(part);
    return fewest(fitting(part, parts(declared).filter(isRecordLike)).map((candidate) => {
      const index = stringIndex(candidate);
      const named = checker.getPropertiesOfType(part).filter((p) => !p.name.startsWith("__@")).flatMap((p) => {
        const type = checker.getTypeOfSymbolAtLocation(p, at);
        // Convex drops fields whose value is undefined; a null stays and must be declared.
        if (members(type).every((t) => t.flags & ts.TypeFlags.Undefined)) return [];
        const field = candidate.getProperty(p.name);
        const target = field ? checker.getTypeOfSymbolAtLocation(field, at) : index;
        return target ? undeclaredFields(type, target, at, `${path}.${p.name}`, depth + 1) : [`${path}.${p.name}`];
      });
      const keyed = !dynamic ? [] : index ? undeclaredFields(dynamic, index, at, `${path}[key]`, depth + 1) : [`${path}[key]`];
      return [...named, ...keyed];
    }));
  });
}

/** The types a function can return: each `return` in its own body, and its declared return type. */
function returnedTypes(fn: ts.Node): ts.Type[] {
  const found: ts.Type[] = [];
  const signature = checker.getTypeAtLocation(fn).getCallSignatures()[0];
  if (signature) found.push(signature.getReturnType());
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) found.push(checker.getTypeAtLocation(fn.body));
  else if (ts.isFunctionLike(fn) && "body" in fn && fn.body) {
    const visit = (node: ts.Node) => {
      if (ts.isReturnStatement(node) && node.expression) found.push(checker.getTypeAtLocation(node.expression));
      // A nested function's returns are its own.
      if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn.body, visit);
  }
  return found.map((type) => checker.getAwaitedType(type) ?? type);
}

/** Fields a function definition's handler returns that its `returns` validator doesn't declare. */
function undeclaredReturns(definition: ts.ObjectLiteralExpression): string[] {
  const property = (key: string) => definition.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === key);
  const returns = property("returns");
  // Registry entries (defineUserQuery, defineUserMutation) name their handler `run`.
  const handler = property("handler") ?? property("run");
  if (!returns || !ts.isPropertyAssignment(returns) || !handler) return [];
  const declared = checker.getTypeAtLocation(returns.initializer).getProperty("type");
  if (!declared) return [];
  const target = checker.getTypeOfSymbolAtLocation(declared, returns);
  const fn = ts.isPropertyAssignment(handler) ? (ts.isIdentifier(handler.initializer) ? declarationOf(handler.initializer) ?? handler.initializer : handler.initializer) : handler;
  return [...new Set(returnedTypes(fn).flatMap((type) => undeclaredFields(type, target, returns, "result")))];
}

const reads: string[] = [];
const missingReturns: string[] = [];
const problems: string[] = [];
const verbose = process.argv.includes("--verbose");

for (const tree of program.getSourceFiles().filter((file) => sources.includes(relative(file.fileName)))) {
  const file = relative(tree.fileName);
  const seen = new Map<string, number>();
  const add = (node: ts.Node, table: string) => {
    const base = `${file}:${enclosingName(node)}:${table}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    reads.push(count === 1 ? base : `${base}#${count}`);
    if (verbose) console.log(reads.at(-1), "=>", node.getText().replace(/\s+/g, " ").slice(0, 170));
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "collect" && node.arguments.length === 0 && isDatabaseQuery(node.expression.expression)) {
      add(node, tableOf(node.expression.expression));
    }
    if (ts.isForOfStatement(node) && node.awaitModifier && isDatabaseQuery(node.expression)) add(node, tableOf(node.expression));
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /_generated\/server$/.test(node.moduleSpecifier.text) && file !== "convex/lib/functions.ts" && !node.importClause?.isTypeOnly) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (!element.isTypeOnly && (imported === "mutation" || imported === "internalMutation")) problems.push(`${file}: import \`${imported}\` from convex/lib/functions.ts, so its writes run the database triggers.`);
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Migrations" && !/\binternalMutation\b/.test(node.arguments?.[1]?.getText() ?? "")) {
      problems.push(`${file}: pass { internalMutation } from convex/lib/functions.ts to new Migrations(...), so migrations run the database triggers.`);
    }
    // Any builder, including custom ones such as defineUserQuery: a definition with `returns` and `handler`.
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.arguments[0] && ts.isObjectLiteralExpression(node.initializer.arguments[0])) {
      const undeclared = undeclaredReturns(node.initializer.arguments[0]);
      if (undeclared.length) problems.push(`${file}:${node.name.text}: returns ${undeclared.join(", ")}, which its \`returns\` validator doesn't declare; Convex rejects them at runtime. Return only declared fields, or declare them.`);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && ALL_BUILDERS.includes(node.initializer.expression.text)) {
      const definition = node.initializer.arguments[0];
      const handler = definition && ts.isObjectLiteralExpression(definition) ? definition.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "handler") : undefined;
      const handlerFn = handler && ts.isPropertyAssignment(handler) ? (ts.isIdentifier(handler.initializer) ? declarationOf(handler.initializer) ?? handler.initializer : handler.initializer) : handler;
      if (handlerFn && takesSizedByArguments(handlerFn).length) argumentSizedTakes.push(`${file}:${node.name.text}`);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && BUILDERS.includes(node.initializer.expression.text)) {
      const kind = node.initializer.expression.text;
      const definition = node.initializer.arguments[0];
      const name = `${file}:${node.name.text}`;
      if (!definition || !ts.isObjectLiteralExpression(definition)) problems.push(`${name}: define the ${kind} with an object, so its validators are checked.`);
      else {
        const property = (key: string) => definition.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === key);
        if (!property("returns")) missingReturns.push(name);
        const handler = property("handler");
        if (kind === "query" && handler) {
          const body = ts.isPropertyAssignment(handler) ? (ts.isIdentifier(handler.initializer) ? declarationOf(handler.initializer) ?? handler.initializer : handler.initializer) : handler;
          const where = clockRead(body);
          if (where) problems.push(`${name}: a query can't read the clock (${where}); schedule the change or pass the time in.`);
        }
      }
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
const rules = JSON.parse(readFileSync("scripts/convex-rules.json", "utf8")) as { unboundedReads: Listed; missingReturns: { pending: Record<string, string> }; argumentSizedTakes: { bounded: Record<string, string> } };
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

const sizedByArguments = new Set(argumentSizedTakes);
for (const fn of argumentSizedTakes) if (!(fn in rules.argumentSizedTakes.bounded)) problems.push(`${fn}: .take() is sized by the function's arguments; clamp it with Math.min, or list it with why it stays small.`);
for (const [fn, reason] of Object.entries(rules.argumentSizedTakes.bounded)) {
  if (!sizedByArguments.has(fn)) problems.push(`${fn}: listed as an argument-sized take but no longer is; remove it.`);
  if (reason.trim().length < 15) problems.push(`${fn}: say why its size stays small.`);
}

if (problems.length) {
  console.error(`Convex rules: ${problems.length} problem${problems.length === 1 ? "" : "s"}.\n\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`Convex rules: ${Object.keys(bounded).length} whole-result reads bounded with a reason, ${Object.keys(pending).length} pending; ${Object.keys(rules.missingReturns.pending).length} functions waiting on a returns validator.`);
