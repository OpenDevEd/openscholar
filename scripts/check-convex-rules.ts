// Convex rules from the Convex reviewer (get-convex/agent-skills), checked in CI (#350):
//
// Every list pages by cursor (#428). Nothing reads, returns or loads a whole list, since
// any list a person or a service can add to grows without limit; infinite scroll pages too.
//
// - No `.collect()` or `for await` over a database query. Read a page with `.paginate()`,
//   or a named cap with `.take(CAP)` that the writes enforce. A read waiting on a fix is
//   listed in scripts/convex-rules.json under unboundedReads.pending with its issue.
// - A public function (`query`, `mutation`, `action`, `defineUserQuery`,
//   `defineUserMutation`, `defineUserAction`) returns a list or record only as the `page` of a pagination
//   result. Any other array or record in its `returns` validator, top level or nested, is
//   listed under listReturns.pending with the issue that pages or caps it. Keys are the
//   function and the list's path, with a page's items written like a list's (`[]`), so
//   turning a list into a page keeps its items' keys. An untyped value (`v.any()`) in a
//   public function's `returns` can hold any list, so it's listed under
//   untypedReturns.pending with the issue that types it. A list capped on write
//   (`capped(...)` from convex/lib/listCaps.ts) is a record's field and passes; caps are
//   set only in the schema and its validators files (#426).
// - Client code and actions never load every page: no `loadMore` from an effect or a loop,
//   and no loop that reads page after page by cursor into one array. Waiting fixes are
//   listed under everyPage.pending.
// - Pending lists only shrink: an entry that isn't pending on `dev` fails, so a fixed
//   list can't be swapped for a new one. Fix it instead of listing it.
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
// Run with `npm run check:convex-rules`; `-- --list` prints every key by rule, `-- --list --verbose` each read's query too.

import { execSync } from "node:child_process";
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
// Client code that calls Convex, for the every-page rule.
const clientSources = ["app", "components", "lib", "hooks"].flatMap((dir) => {
  const walk = (folder: string): string[] =>
    readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(file);
      return /\.tsx?$/.test(file) && !/\.test\.|\.d\.ts$/.test(file) ? [file] : [];
    });
  try { return walk(dir); } catch { return []; }
});
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
function undeclaredFields(actual: ts.Type, declared: ts.Type, at: ts.Node, path: string, open = new Set<string>()): string[] {
  if (actual.flags & skipped || declared.flags & skipped) return [];
  // A pair already being compared further up this path is a recursive type: its fields are checked there.
  const pair = `${(actual as { id?: number }).id}:${(declared as { id?: number }).id}`;
  if (open.has(pair)) return [];
  open.add(pair);
  const found = parts(actual).flatMap((part) => {
    if (part.flags & skipped) return [];
    if (isArrayLike(part)) {
      // Every element of a tuple, against the element type of each array branch it fits.
      const elements = checker.getTypeArguments(part as ts.TypeReference);
      return fewest(fitting(part, parts(declared).filter(isArrayLike)).map((candidate) => {
        const target = checker.getTypeArguments(candidate as ts.TypeReference)[0];
        return elements.flatMap((element) => undeclaredFields(element, target, at, `${path}[]`, open));
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
        return target ? undeclaredFields(type, target, at, `${path}.${p.name}`, open) : [`${path}.${p.name}`];
      });
      const keyed = !dynamic ? [] : index ? undeclaredFields(dynamic, index, at, `${path}[key]`, open) : [`${path}[key]`];
      return [...named, ...keyed];
    }));
  });
  open.delete(pair);
  return found;
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

/** A validator type's property, such as a VObject's `fields` or a VArray's `element`. */
function validatorPart(type: ts.Type, name: string, at: ts.Node) {
  const part = type.getProperty(name);
  return part ? checker.getTypeOfSymbolAtLocation(part, at) : undefined;
}

/**
 * Every list (`[]`) and record (`{}`) a validator type holds outside a pagination page,
 * by path. A page's items are written like a list's, so a list that becomes a page keeps
 * its items' keys. Recursive validators stop where they repeat.
 */
function listPaths(type: ts.Type, at: ts.Node, where = "", stack = new Set<ts.Type>(), out = new Set<string>()): Set<string> {
  if (stack.has(type)) return out;
  stack.add(type);
  if (type.isUnion()) for (const member of type.types) listPaths(member, at, where, stack, out);
  // A capped list's type is `VArray<...> & Capped<N>`: check the validator inside the intersection.
  const base = type.isIntersection() ? type.types.find((member) => /^V[A-Z]/.test(member.getSymbol()?.getName() ?? "")) ?? type : type;
  const name = base.getSymbol()?.getName() ?? "";
  // A list the schema caps on write (convex/lib/listCaps.ts) is a record's field, not a list to page.
  const isCapped = Boolean(type.getProperty("__listCap"));
  if (name === "VArray") {
    if (!isCapped) out.add(`${where}[]`);
    const element = validatorPart(base, "element", at);
    if (element) listPaths(element, at, `${where}[]`, stack, out);
  } else if (name === "VRecord") {
    if (!isCapped) out.add(`${where}{}`);
    const value = validatorPart(base, "value", at);
    if (value) listPaths(value, at, `${where}{}`, stack, out);
  } else if (name === "VObject") {
    const fields = validatorPart(type, "fields", at);
    const names = fields?.getProperties().map((field) => field.getName()) ?? [];
    const pageField = fields?.getProperty("page");
    const pageType = pageField ? checker.getTypeOfSymbolAtLocation(pageField, at) : undefined;
    const paged = names.includes("isDone") && names.includes("continueCursor") && pageType?.getSymbol()?.getName() === "VArray";
    for (const field of fields?.getProperties() ?? []) {
      const fieldType = checker.getTypeOfSymbolAtLocation(field, at);
      if (paged && field.getName() === "page") {
        const element = validatorPart(fieldType, "element", at);
        if (element) listPaths(element, at, `${where}[]`, stack, out);
      } else listPaths(fieldType, at, `${where}.${field.getName()}`, stack, out);
    }
  } else if (name === "VAny") {
    // An untyped value can hold any list; `*` marks it for the untyped-returns rule, unless
    // its JSON size is bounded on write (`sized(...)` from convex/lib/listCaps.ts).
    if (!type.getProperty("__jsonBytes")) out.add(`${where}*`);
  } else if (name === "VUnion") {
    const members = validatorPart(type, "members", at);
    if (members) for (const member of checker.getTypeArguments(members as ts.TypeReference)) listPaths(member, at, where, stack, out);
  }
  stack.delete(type);
  return out;
}

/** Lists in a `returns` value: a validator, or a map of field validators that Convex wraps in an object. */
function returnedLists(type: ts.Type, at: ts.Node): Set<string> {
  if (/^V[A-Z]/.test(type.getSymbol()?.getName() ?? "") || type.isUnion()) return listPaths(type, at);
  const out = new Set<string>();
  for (const field of type.getProperties()) for (const list of listPaths(checker.getTypeOfSymbolAtLocation(field, at), at, `.${field.getName()}`)) out.add(list);
  return out;
}

/** The function holding `node`, named by its variable, declaration or property. */
function holderName(node: ts.Node): string {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) return current.name.getText();
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
  }
  return "(module)";
}

/**
 * Whether `loop` reads page after page: a call given a cursor or an offset (`cursor`,
 * `paginationOpts`, `start`, `offset`, `skip`), or a page's continuation read.
 */
function readsByCursor(loop: ts.Node) {
  let reads = false;
  let awaits = false;
  const scanAwaits = (node: ts.Node) => {
    if (ts.isAwaitExpression(node)) awaits = true;
    if (!awaits) ts.forEachChild(node, scanAwaits);
  };
  scanAwaits(loop);
  // Offsets are a read only in a loop that waits on something: `ranges.push({ start })` isn't one.
  const keys = awaits ? ["cursor", "paginationOpts", "start", "offset", "skip"] : ["cursor", "paginationOpts"];
  const visit = (node: ts.Node) => {
    if (reads) return;
    if (ts.isPropertyAccessExpression(node) && ["continueCursor", "nextCursor", "hasMore"].includes(node.name.text)) reads = true;
    const gathering = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["push", "concat", "set", "add"].includes(node.expression.name.text);
    if (ts.isCallExpression(node) && !gathering && node.arguments.some((arg) => ts.isObjectLiteralExpression(arg) && arg.properties.some((p) => p.name && ts.isIdentifier(p.name) && keys.includes(p.name.text)))) reads = true;
    ts.forEachChild(node, visit);
  };
  visit(loop);
  return reads;
}

/** Names declared inside `scope`: a per-iteration batch declared in a loop doesn't outlive it. */
function declaredIn(scope: ts.Node) {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return names;
}

/** The variable at the root of `a.b.c` or `a[i]`. */
function rootName(expression: ts.Expression): string | undefined {
  let current = expression;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current) || ts.isParenthesizedExpression(current)) current = current.expression;
  return ts.isIdentifier(current) ? current.text : current.kind === ts.SyntaxKind.ThisKeyword ? "this" : undefined;
}

/**
 * Whether `loop` gathers into something that outlives an iteration: an array, map or set
 * declared outside it, by `.push`, `.concat`, `.set`, `.add`, an indexed write or a spread
 * reassignment. A batch declared inside the loop and written out each time isn't gathering.
 */
function gathers(loop: ts.Node) {
  const inner = declaredIn(loop);
  const outer = (expression: ts.Expression) => {
    const name = rootName(expression);
    return name !== undefined && !inner.has(name);
  };
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["push", "concat", "set", "add"].includes(node.expression.name.text) && outer(node.expression.expression)) found = true;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isElementAccessExpression(node.left) && outer(node.left.expression)) found = true;
      if (ts.isArrayLiteralExpression(node.right) && node.right.elements.some(ts.isSpreadElement) && outer(node.left)) found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(loop);
  return found;
}

/** Whether `fn` calls `name`, its own name. */
function callsItself(fn: ts.Node, name: string) {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) found = true;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn, visit);
  return found;
}

const isLoop = (node: ts.Node) => ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node);
const isEffect = (call: ts.CallExpression) => /(^|\.)use(Layout)?Effect$/.test(call.expression.getText());

/**
 * Where `tree` loads every page: `loadMore` (by any local name) called from an effect,
 * including a named callback, or from a loop; a cursor or offset loop that gathers pages;
 * or a function that calls itself with the next cursor and keeps every page. Repeats
 * in one function are numbered, so a second one counts as a new entry.
 */
function everyPageLoads(tree: ts.SourceFile, file: string): string[] {
  // Local names for loadMore: `loadMore`, `{ loadMore: more }`, and `list.loadMore`.
  const loaders = new Set(["loadMore"]);
  const functionsByName = new Map<string, ts.Node>();
  const scan = (node: ts.Node) => {
    if (ts.isBindingElement(node) && node.propertyName && ts.isIdentifier(node.propertyName) && node.propertyName.text === "loadMore" && ts.isIdentifier(node.name)) loaders.add(node.name.text);
    if (ts.isFunctionDeclaration(node) && node.name) functionsByName.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) functionsByName.set(node.name.text, node.initializer);
    ts.forEachChild(node, scan);
  };
  scan(tree);
  const isLoadMore = (call: ts.CallExpression) => {
    const callee = call.expression;
    return (ts.isIdentifier(callee) && loaders.has(callee.text)) || (ts.isPropertyAccessExpression(callee) && callee.name.text === "loadMore");
  };
  // Effect callbacks, written inline or passed by name.
  const effectBodies = new Set<ts.Node>();
  const findEffects = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isEffect(node) && node.arguments[0]) {
      const callback = node.arguments[0];
      const body = ts.isIdentifier(callback) ? functionsByName.get(callback.text) : callback;
      if (body) effectBodies.add(body);
    }
    ts.forEachChild(node, findEffects);
  };
  findEffects(tree);
  const counts = new Map<string, number>();
  const found: string[] = [];
  const add = (node: ts.Node) => {
    const key = `${file}:${holderName(node)}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    found.push(count === 1 ? key : `${key}#${count}`);
  };
  const visit = (node: ts.Node, inEffect: boolean, inLoop: boolean) => {
    const effect = inEffect || effectBodies.has(node);
    const loop = inLoop || isLoop(node);
    if (ts.isCallExpression(node) && isLoadMore(node) && (effect || loop)) add(node);
    if (isLoop(node) && readsByCursor(node) && gathers(node)) add(node);
    // A function that calls itself with the next cursor and keeps every page it reads.
    const name = ts.isFunctionDeclaration(node) && node.name ? node.name.text : (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : undefined;
    if (name && callsItself(node, name) && readsByCursor(node) && gathers(node)) add(node);
    ts.forEachChild(node, (child) => visit(child, effect, loop));
  };
  visit(tree, false, false);
  return found;
}

/** Where list caps may be set: the schema and the validators it's built from (#426). */
const capsAllowed = (file: string) => file === "convex/schema.ts" || file === "convex/lib/listCaps.ts" || file === "lib/research/records.ts" || /[vV]alidators\.ts$/.test(file);
/** `capped(...)` calls in `tree` outside the files that define stored validators. */
function capsOutsideValidators(tree: ts.SourceFile, file: string): string[] {
  if (capsAllowed(file)) return [];
  // `capped` under any local name: `import { capped as bound }`, or `caps.capped` from `import * as caps`.
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !/listCaps$/.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) if (["capped", "sized"].includes((element.propertyName ?? element.name).text)) names.add(element.name.text);
  }
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isCapped = (ts.isIdentifier(callee) && names.has(callee.text)) || (ts.isPropertyAccessExpression(callee) && ["capped", "sized"].includes(callee.name.text) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text));
      if (isCapped) found.push(`${file}:${holderName(node)}: caps a list outside the validators files; cap a stored field where its validator is defined, and page any other list.`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

const listReturns: string[] = [];
const everyPage: string[] = [];
const PUBLIC_DEFINITIONS = [...BUILDERS, "defineUserQuery", "defineUserMutation", "defineUserAction"];
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
    if (!file.startsWith("convex/migrations/") && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && PUBLIC_DEFINITIONS.includes(node.initializer.expression.text)) {
      const definition = node.initializer.arguments[0];
      const returns = definition && ts.isObjectLiteralExpression(definition) ? definition.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "returns") : undefined;
      // `returns: validator`, `{ returns }` and a field map (`returns: { items: v.array(...) }`).
      const value = returns && ts.isPropertyAssignment(returns) ? returns.initializer : returns && ts.isShorthandPropertyAssignment(returns) ? returns.name : undefined;
      if (value) for (const list of returnedLists(checker.getTypeAtLocation(value), value)) listReturns.push(`${file}:${node.name.text}:${list}`);
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
  // Migrations walk whole tables by design, a batch at a time.
  if (!file.startsWith("convex/migrations/")) everyPage.push(...everyPageLoads(tree, file));
  problems.push(...capsOutsideValidators(tree, file));
}
for (const file of clientSources) {
  const text = readFileSync(file, "utf8");
  const clientTree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  everyPage.push(...everyPageLoads(clientTree, file));
  problems.push(...capsOutsideValidators(clientTree, file));
}

if (process.argv.includes("--list")) {
  console.log([...reads.map((key) => `unboundedReads ${key}`), ...listReturns.map((key) => `${key.endsWith("*") ? "untypedReturns" : "listReturns"} ${key}`), ...everyPage.map((key) => `everyPage ${key}`)].join("\n"));
  process.exit(0);
}

type Pending = { pending: Record<string, string> };
type Rules = { unboundedReads: Pending & { bounded?: Record<string, string> }; listReturns: Pending; untypedReturns?: Pending; everyPage: Pending; missingReturns: Pending; argumentSizedTakes: { bounded: Record<string, string> } };
const rules = JSON.parse(readFileSync("scripts/convex-rules.json", "utf8")) as Rules;
// An issue, optionally followed by a note for whoever fixes it: "#427" or "#427: a user's keys".
const issue = /^#\d+(: .+)?$/;

/** Checks found keys against a pending list: each found one is listed, each listed one is found. */
function checkPending(section: string, found: string[], pending: Record<string, string>, fix: string) {
  const present = new Set(found);
  for (const key of found) if (!(key in pending)) problems.push(`${key}: ${fix}`);
  for (const [key, ref] of Object.entries(pending)) {
    if (!present.has(key)) problems.push(`${key}: listed under ${section}.pending but fixed now; remove it.`);
    if (!issue.test(ref)) problems.push(`${key}: ${section}.pending needs the issue that fixes it, such as "#427".`);
  }
}
if (rules.unboundedReads.bounded) problems.push("unboundedReads.bounded: a reason isn't a bound; page or cap these reads, or list them as pending with their issue.");
checkPending("unboundedReads", [...new Set(reads)], rules.unboundedReads.pending, "a whole-result read; read a page with .paginate() or a named cap with .take(CAP).");
const untyped = (key: string) => key.endsWith("*");
checkPending("listReturns", [...new Set(listReturns.filter((key) => !untyped(key)))], rules.listReturns.pending, "returns a list outside a pagination page; return one page by cursor (paginationResultValidator), or cap the field where it's written.");
checkPending("untypedReturns", [...new Set(listReturns.filter(untyped))], rules.untypedReturns?.pending ?? {}, "returns an untyped value (v.any()), which can hold a list nothing checks; give it a validator.");
checkPending("everyPage", [...new Set(everyPage)], rules.everyPage.pending, "loads every page; load the next page when the person asks for it, and stream exports page by page.");

// Pending lists only shrink: compared with dev where this branch left it.
// CI passes RULES_BASE: a pull request's base, or the commit a push moved dev from. Locally, origin/dev.
let base: Rules | undefined;
const git = (command: string) => execSync(command, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
const given = process.env.RULES_BASE && !/^0+$/.test(process.env.RULES_BASE) ? process.env.RULES_BASE : "origin/dev";
try {
  base = JSON.parse(git(`git show ${git(`git merge-base HEAD ${given}`)}:scripts/convex-rules.json`)) as Rules;
} catch {
  if (process.env.CI) problems.push(`scripts/convex-rules.json: can't read it at ${given} to check the pending lists only shrink; fetch the full history.`);
  else console.warn(`Convex rules: no ${given} to compare pending lists with; skipping the shrink check.`);
}
if (base) {
  for (const section of ["unboundedReads", "listReturns", "untypedReturns", "everyPage"] as const) {
    const before = base[section] as (Pending & { bounded?: Record<string, string> }) | undefined;
    if (!before) continue;
    const was = new Set([...Object.keys(before.pending), ...Object.keys(before.bounded ?? {})]);
    for (const key of Object.keys(rules[section]?.pending ?? {})) if (!was.has(key)) problems.push(`${key}: not pending under ${section} on dev; fix it instead of listing it.`);
  }
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
console.log(`Convex rules: pending ${Object.keys(rules.unboundedReads.pending).length} whole-result reads, ${Object.keys(rules.listReturns.pending).length} returned lists, ${Object.keys(rules.untypedReturns?.pending ?? {}).length} untyped returns and ${Object.keys(rules.everyPage.pending).length} every-page loads; ${Object.keys(rules.missingReturns.pending).length} functions waiting on a returns validator.`);
