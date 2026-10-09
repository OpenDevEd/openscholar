#!/usr/bin/env node

// The UI rules agents kept breaking, checked on every .ts, .tsx and .css file
// under app/ and components/ and on the copy in messages/. Each problem names the
// fix. A line that needs an exception says why on the line before it:
//
//   // ui-rules-allow: <rule> -- <reason>
//
// animation-clash: an element that is animated (a CSS animation class or
// Framer props) must not also transition opacity or transform. The two fight
// over the same property: Firefox then jumps back and forth as an animation
// ends, and a Framer layout animation wobbles. Tailwind's bare `transition`
// covers opacity and transform too, so only explicit property lists are safe
// on animated elements. Shared `components/ui` parts name the properties they
// transition, so animating one is safe. A `before:` or `after:` class styles
// another box. A class string or `cn(...)` call that clashes by itself is
// reported where it is written; a constant from the same file is read where
// className uses it; and each stylesheet rule is checked the same way. new-el
// runs the same rules (tools/uiRules.ts); keep them in step.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
// TypeScript 7 ships no JavaScript API until 7.1, so this script parses with TypeScript 6.
import ts from "typescript6";

// The utilities that move opacity or transform. Bare `transition` and
// `transition-all` cover both; an arbitrary list counts when it names one.
// Every animation counts, the built-in spin, pulse, ping and bounce too.
const BROAD_TRANSITION = /(?:^|[\s"'`])(?:[\w-]+:)*transition(?:-all)?(?=$|[\s"'`])/;
const MOVING = new Set(["opacity", "transform", "translate", "scale", "rotate", "all"]);
const PSEUDO_ELEMENTS = new Set(["before", "after", "placeholder", "file", "marker", "selection", "first-letter", "first-line", "backdrop"]);
/** A class without its variants and important mark: `hover:transition-opacity!` is `transition-opacity`. */
const utility = (token) => (token.split(":").at(-1) ?? "").replace(/^!|!$/g, "");
/** The box a class styles: the element, or a pseudo-element its variants name (`before:`). */
const box = (token) => token.split(":").slice(0, -1).find((variant) => PSEUDO_ELEMENTS.has(variant)) ?? "";
function transitionsMovement(token) {
  const name = utility(token);
  const list = name.match(/^transition-\[(.+)\]$/)?.[1];
  if (list) return list.split(",").some((property) => MOVING.has(property.trim()));
  return /^transition(-all|-opacity|-transform)?$/.test(name);
}
const animates = (token) => /^(fade-enter|animate-[\w[\]-]+)$/.test(utility(token)) && utility(token) !== "animate-none";
/** The classes of a class list, grouped by the box they style. */
function boxes(classes) {
  const groups = new Map();
  for (const token of classes.split(/[\s"'`{}()]+/).filter(Boolean)) groups.set(box(token), [...(groups.get(box(token)) ?? []), token]);
  return groups;
}
/** Whether one box both animates and transitions opacity or transform; Framer props animate the element itself. */
const clashes = (classes, framer) => [...boxes(classes)].some(([target, tokens]) => tokens.some(transitionsMovement) && ((framer && target === "") || tokens.some(animates)));
// The helpers that join their arguments into one class list; cva and tv take alternatives instead.
const JOINERS = new Set(["cn", "clsx", "cx", "twMerge", "classNames"]);
const joins = (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && JOINERS.has(node.expression.text);
/** A class list written as one value: a string, a template, or a call joining classes. */
const classValue = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || joins(node);
// The words of a CSS transition that name no property.
const TIMING = /^(ease(-in|-out|-in-out)?|linear|step-start|step-end|allow-discrete|normal|-?[\d.]+m?s)$/;
/** Whether one item of a `transition` shorthand moves opacity or transform; an item that names no property transitions all. */
function cssItemMoves(item) {
  const words = item.split(/\s+/).filter((word) => word && !TIMING.test(word));
  return words.length === 0 || words.some((word) => MOVING.has(word));
}
/** The declaration of these properties that applies: a later one wins unless an earlier one is !important. Its value comes without the !important. */
function cascade(declarations, properties) {
  let applied;
  let important = false;
  for (const [property, value] of declarations.filter(([name]) => properties.includes(name))) {
    const strong = /!important\s*$/i.test(value);
    if (strong || !important) applied = [property, value.replace(/!important\s*$/i, "").trim()];
    important ||= strong;
  }
  return applied;
}
/** A comma-separated CSS list; functions go first, so the commas inside cubic-bezier() don't split it. */
const cssList = (value) => value.replace(/[\w-]+\([^)]*\)/g, " ").split(",").map((item) => item.trim());
/** Whether one CSS rule both animates and transitions opacity or transform. */
function cssClashes(body) {
  const declarations = body
    .split(";")
    .map((declaration) => declaration.split(":"))
    .filter((parts) => parts.length > 1)
    .map(([name, ...value]) => [name.trim().toLowerCase(), value.join(":").trim()]);
  const animation = cascade(declarations, ["animation", "animation-name"]);
  const transition = cascade(declarations, ["transition", "transition-property"]);
  if (!animation || !transition) return false;
  const animates = cssList(animation[1]).some((item) => item !== "" && !/(^|\s)none(\s|$)/i.test(item));
  const moves = cssList(transition[1]).some((item) => (transition[0] === "transition" ? cssItemMoves(item) : MOVING.has(item)));
  return animates && moves;
}
/** Each CSS rule's own declarations, without the rules nested in it, and where its brace opens. */
function cssRules(text) {
  const rules = [];
  const open = [];
  for (let index = 0; index < text.length; index++) {
    const parent = open.at(-1);
    if (text[index] === "{") {
      // The text since the parent's last declaration is the nested rule's selector.
      if (parent) parent.body = parent.body.replace(/[^;]*$/, "");
      open.push({ start: index, body: "" });
    } else if (text[index] === "}") {
      rules.push(...open.splice(-1));
      if (open.length) open[open.length - 1].body += ";";
    } else if (parent) parent.body += text[index];
  }
  return rules;
}
/** The names a declaration or parameter binds, through destructuring. */
const boundNames = (name) => (ts.isIdentifier(name) ? [name.text] : name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : boundNames(element.name))));
/** The variable a block declares under this name, if any. */
const declares = (block, name) =>
  block.statements.flatMap((statement) => (ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])).find((declaration) => boundNames(declaration.name).includes(name));
/** The value an identifier's variable starts with, found as scopes resolve it; a parameter or a destructured name has none. */
function declaredValue(node) {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some((parameter) => boundNames(parameter.name).includes(node.text))) return undefined;
    const declaration = ts.isBlock(scope) || ts.isSourceFile(scope) ? declares(scope, node.text) : undefined;
    if (declaration) return ts.isIdentifier(declaration.name) ? declaration.initializer : undefined;
  }
  return undefined;
}
/** An expression without `( )`, `as`, `satisfies` or `!` around it. */
const unwrap = (node) => (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) ? unwrap(node.expression) : node);
/** The value of the same-file constant an identifier reads, when it can hold classes. */
function constantValue(node) {
  const readsVariable = ts.isIdentifier(node) && !((ts.isPropertyAccessExpression(node.parent) || ts.isPropertyAssignment(node.parent)) && node.parent.name === node);
  const initializer = readsVariable ? declaredValue(node) : undefined;
  const value = initializer && unwrap(initializer);
  return value && (classValue(value) || ts.isConditionalExpression(value) || ts.isBinaryExpression(value) || ts.isIdentifier(value)) ? value : undefined;
}
// ponytail: past 64 combinations the lists merge into one, which can report a clash between exclusive branches.
const MAX_LISTS = 64;
const capped = (lists) => {
  const unique = [...new Set(lists)];
  return unique.length > MAX_LISTS ? [[...new Set(unique.join(" ").split(/\s+/))].join(" ")] : unique;
};
const FRAMER_PROPS = new Set(["initial", "animate", "exit", "layout", "layoutId", "variants", "whileHover", "whileTap", "whileInView", "whileFocus", "whileDrag"]);
// The `uppercase` utility with variants or the important mark (`sm:uppercase`,
// `uppercase!`), looked for only where classes are written so prose that says
// "uppercase" passes; and the CSS declaration anywhere.
const UPPERCASE_CLASS = /(?:^|[\s:!])!?uppercase!?(?=$|[\s"'`])/;
const UPPERCASE_CSS = /text-transform\s*:\s*uppercase/i;
const CLASS_HELPERS = new Set(["cn", "cva", "clsx", "cx", "twMerge", "tv", "classNames"]);
const CLASS_NAMES = /(class(name)?(es|s)?|styles?|variants?|texttransform)$/i;
// The characters, and the entities JSX text keeps undecoded.
const DOT = /[·•]|&(?:middot|bull|#183|#x0*b7|#8226|#x2022);/i;
// A short status label ("Loading", "Loading author profile..."), not a sentence that mentions loading.
const LOADING = /^loading\b[^.!?]{0,40}(…|\.\.\.)?$/i;
// The translation functions: `t`, and `tc` or `tUI` for a second namespace.
const TRANSLATE = /^t([a-z]|[A-Z]\w*)?$/;
const SR_ONLY = /(?:^|[\s"'`])sr-only(?=$|[\s"'`])/;
const allowed = (line, rule) => new RegExp(`ui-rules-allow:\\s*${rule}\\s+--\\s*\\S`).test(line ?? "");

const FIX = {
  "animation-clash": "animates and transitions opacity or transform; put the animation on a wrapper, or transition only colours, borders and shadows.",
  uppercase: "no uppercase labels; build hierarchy with weight, size and colour.",
  "native-title": "native title tooltip; use TooltipHint or Tooltip from components/ui/tooltip and keep the name in aria-label.",
  "dot-separator": "no dot separators; use spacing, a divider or an icon.",
  initials: "AvatarFallback shows an icon when there is no photo, never initials or text (see IdentityAvatar and AuthorAvatar).",
  "loading-text": "no \"Loading\" text; show the shared Spinner, or hold the final size until the data is there.",
};

/** Every string in a messages file, with the key that holds it. */
const strings = (value, key) =>
  typeof value === "string" ? [[key, value]] : value && typeof value === "object" ? Object.entries(value).flatMap(([inner, child]) => strings(child, inner)) : [];

// The message keys that are Loading labels, so a translated label is caught
// where it is rendered. A key counts only when every message of that name is
// one, since the namespace a call reads from isn't known here.
const english = strings(JSON.parse(readFileSync("messages/en-US.json", "utf8")), "");
const loadingMessage = ([, value]) => LOADING.test(value.trim());
const otherKeys = new Set(english.filter((message) => !loadingMessage(message)).map(([key]) => key));
const loadingKeys = new Set(english.filter((message) => loadingMessage(message) && !otherKeys.has(message[0])).map(([key]) => key));

function files(dir, extensions) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(file, extensions);
    return extensions.some((extension) => file.endsWith(extension)) ? [file] : [];
  });
}

function check(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  // The class lists each constant adds, read once.
  const constantLists = new Map();
  // What a logical operator can give: `a && b` gives b or nothing, `a || b` and `a ?? b` give one side.
  const logicalLists = (node, seen) => {
    const kind = node.operatorToken.kind;
    if (kind === ts.SyntaxKind.AmpersandAmpersandToken) return capped([...classLists(node.right, seen), ""]);
    if (kind !== ts.SyntaxKind.BarBarToken && kind !== ts.SyntaxKind.QuestionQuestionToken) return undefined;
    return capped([...classLists(node.left, seen), ...classLists(node.right, seen)]);
  };
  // The class lists a constant adds. One that clashes by itself is reported where it is written, so it adds none here.
  const listsOfConstant = (value, seen) => {
    if (seen.has(value)) return [""];
    if (!constantLists.has(value)) {
      const lists = classLists(value, new Set([...seen, value]));
      constantLists.set(value, classValue(value) && lists.some((list) => clashes(list, false)) ? [""] : lists);
    }
    return constantLists.get(value);
  };
  // Every class list a className can produce: the two sides of `a ? b : c`
  // never apply together, and a same-file constant adds the classes it holds.
  const classLists = (node, seen = new Set()) => {
    if (!node) return [""];
    if (ts.isConditionalExpression(node)) return capped([...classLists(node.whenTrue, seen), ...classLists(node.whenFalse, seen)]);
    const logical = ts.isBinaryExpression(node) ? logicalLists(node, seen) : undefined;
    if (logical) return logical;
    const value = constantValue(node);
    if (value) return listsOfConstant(value, seen);
    const children = node.getChildren(source);
    if (children.length === 0) return [node.getText(source)];
    return children.reduce((lists, child) => {
      const texts = classLists(child, seen);
      return capped(lists.flatMap((list) => texts.map((text) => `${list} ${text}`)));
    }, [""]);
  };
  // Whether a class value clashes by itself, wherever it is used.
  const clashesAlone = (node) => classValue(node) && classLists(node, new Set([node])).some((list) => clashes(list, false));
  // Whether a node is part of a larger class list: an element's className, a joining call, or a template.
  const insideClassList = (node) => {
    for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
      if (joins(parent) || ts.isTemplateExpression(parent) || (ts.isJsxAttribute(parent) && parent.name.getText(source) === "className")) return true;
    }
    return false;
  };
  const report = (node, rule) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    if (allowed(lines[line - 1], rule)) return;
    found.push(`${file}:${line + 1} ${rule}: ${FIX[rule]}`);
  };
  // Whether a string sits where classes are written: a className, a class
  // helper's arguments, or a variable or property named for classes or styles.
  const classContext = (node) => {
    for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
      if (ts.isJsxAttribute(parent) && parent.name.getText(source) === "className") return true;
      if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && CLASS_HELPERS.has(parent.expression.text)) return true;
      if ((ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) && CLASS_NAMES.test(parent.name.getText(source))) return true;
    }
    return false;
  };
  // Whether a string is rendered as a JSX child, directly or through a condition.
  const renderedInJsx = (node) => {
    for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
      if (ts.isJsxExpression(parent)) return !ts.isJsxAttribute(parent.parent);
      const passesThrough =
        ts.isParenthesizedExpression(parent) ||
        (ts.isConditionalExpression(parent) && parent.condition !== child) ||
        (ts.isBinaryExpression(parent) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind));
      if (!passesThrough) return false;
    }
    return false;
  };
  // Whether a string is the key of a translation call, `t("loading")`, whose message is a Loading label.
  const translatedLoading = (node) => {
    const call = node.parent;
    if (!ts.isStringLiteral(node) || !ts.isCallExpression(call) || call.arguments[0] !== node) return false;
    return ts.isIdentifier(call.expression) && TRANSLATE.test(call.expression.text) && loadingKeys.has(node.text.split(".").at(-1)) && renderedInJsx(call);
  };
  // Whether a node sits in an element only screen readers get, where a Loading label names a spinner.
  const screenReaderOnly = (node) => {
    for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
      if (!ts.isJsxElement(parent)) continue;
      const className = parent.openingElement.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className");
      return SR_ONLY.test(className?.initializer?.getText(source) ?? "");
    }
    return false;
  };
  // Whether what a node renders can hold text: words, or a value that isn't JSX.
  const rendersText = (node) => {
    if (ts.isJsxText(node)) return node.text.trim() !== "";
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) return node.children.some(rendersText);
    if (ts.isJsxSelfClosingElement(node)) return false;
    if (ts.isJsxExpression(node)) return !!node.expression && rendersText(node.expression);
    if (ts.isParenthesizedExpression(node)) return rendersText(node.expression);
    if (ts.isConditionalExpression(node)) return rendersText(node.whenTrue) || rendersText(node.whenFalse);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return rendersText(node.right);
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) return rendersText(node.left) || rendersText(node.right);
    return !(node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.FalseKeyword || (ts.isIdentifier(node) && node.text === "undefined"));
  };
  const visit = (node) => {
    if (classValue(node) && !insideClassList(node) && clashesAlone(node)) report(node, "animation-clash");
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (UPPERCASE_CSS.test(node.text) || (UPPERCASE_CLASS.test(node.text) && classContext(node))) report(node, "uppercase");
      if (DOT.test(node.text)) report(node, "dot-separator");
      const whole = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
      if (((whole && LOADING.test(node.text.trim()) && renderedInJsx(node)) || translatedLoading(node)) && !screenReaderOnly(node)) report(node, "loading-text");
    }
    if (ts.isJsxText(node)) {
      if (DOT.test(node.text)) report(node, "dot-separator");
      if (LOADING.test(node.text.trim()) && !screenReaderOnly(node)) report(node, "loading-text");
    }
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "AvatarFallback") {
      if (node.children.some(rendersText)) report(node, "initials");
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      let classes = [""];
      let framer = false;
      let style = "";
      let title = null;
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(source);
        if (name === "className") classes = classLists(attribute.initializer);
        if (name === "style" && attribute.initializer) style = attribute.initializer.getText(source);
        if (FRAMER_PROPS.has(name) && tag.startsWith("motion.")) framer = true;
        if (name === "title") title = attribute;
        if (tag === "AvatarFallback" && name === "children" && attribute.initializer && rendersText(attribute.initializer)) report(attribute, "initials");
      }
      if (classes.some((list) => clashes(list, framer))) report(node, "animation-clash");
      // Built-in elements only; an iframe's title is its accessible name, and
      // the hidden Z3988 spans carry citation data for Zotero.
      const coins = tag === "span" && classes.every((list) => /(?:^|[\s"'`])Z3988(?=$|[\s"'`])/.test(list)) && /display:\s*["']none["']/.test(style);
      if (title && /^[a-z]/.test(tag) && tag !== "iframe" && !coins) report(title, "native-title");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const scanLines = (paths, pattern, rule, fix) =>
  paths.flatMap((file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    return lines.flatMap((line, index) => (pattern.test(line) && !allowed(lines[index - 1], rule) ? [`${file}:${index + 1} ${rule}: ${fix}`] : []));
  });
// Shared parts name what they transition, so animating any of them is safe.
const broad = scanLines(files("components/ui", [".tsx"]), BROAD_TRANSITION, "animation-clash", "a shared part uses transition or transition-all; name the properties it transitions.");
const cssFiles = [...files("app", [".css"]), ...files("components", [".css"])];
const stylesheets = scanLines(cssFiles, UPPERCASE_CSS, "uppercase", FIX.uppercase);
const stylesheetClashes = cssFiles.flatMap((file) => {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  // Comments blanked with their newlines kept, so a brace in one can't open a rule.
  const plain = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  return cssRules(plain)
    .filter((rule) => cssClashes(rule.body))
    .map((rule) => plain.slice(0, rule.start).split("\n").length)
    .sort((a, b) => a - b)
    .filter((line) => !allowed(lines[line - 2], "animation-clash"))
    .map((line) => `${file}:${line} animation-clash: ${FIX["animation-clash"]}`);
});

// Copy shown in the app lives in messages/. Values are read decoded, so an
// escaped \u00b7 counts too; the line is the one that holds the key.
const copy = files("messages", [".json"]).flatMap((file) => {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  return strings(JSON.parse(text), "")
    .filter(([, value]) => DOT.test(value))
    .map(([key]) => `${file}:${lines.findIndex((line) => line.includes(`"${key}"`)) + 1} dot-separator: ${FIX["dot-separator"]}`);
});

const problems = [...files("components", [".ts", ".tsx"]), ...files("app", [".ts", ".tsx"])].flatMap(check).concat(broad, stylesheets, stylesheetClashes, copy);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("UI rules hold: no animation clashes, uppercase labels, native title tooltips, dot separators, initials or Loading text.");
