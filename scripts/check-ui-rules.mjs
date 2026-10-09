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
/** Whether one item of a CSS transition list moves opacity or transform; an item that names no property transitions all. */
function cssItemMoves(item) {
  const words = item.split(/\s+/).filter((word) => word && !TIMING.test(word));
  return words.length === 0 || words.some((word) => MOVING.has(word));
}
/** Whether one CSS rule both animates and transitions opacity or transform. */
function cssClashes(declarations) {
  const values = new Map(
    declarations
      .split(";")
      .map((declaration) => declaration.split(":"))
      .filter((parts) => parts.length > 1)
      .map(([name, ...value]) => [name.trim().toLowerCase(), value.join(":").trim()]),
  );
  const animation = values.get("animation") ?? values.get("animation-name") ?? "none";
  const transition = values.get("transition") ?? values.get("transition-property") ?? "none";
  // Functions go first: the commas inside cubic-bezier() don't separate transitions.
  return !/^none\b/i.test(animation) && transition.replace(/[\w-]+\([^)]*\)/g, " ").split(",").some(cssItemMoves);
}
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
const allowed = (line, rule) => new RegExp(`ui-rules-allow:\\s*${rule}\\s+--\\s*\\S`).test(line ?? "");

const FIX = {
  "animation-clash": "animates and transitions opacity or transform; put the animation on a wrapper, or transition only colours, borders and shadows.",
  uppercase: "no uppercase labels; build hierarchy with weight, size and colour.",
  "native-title": "native title tooltip; use TooltipHint or Tooltip from components/ui/tooltip and keep the name in aria-label.",
  "dot-separator": "no dot separators; use spacing, a divider or an icon.",
  initials: "AvatarFallback shows an icon when there is no photo, never initials or text (see IdentityAvatar and AuthorAvatar).",
  "loading-text": "no \"Loading\" text; show the shared Spinner, or hold the final size until the data is there.",
};

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
  // Every variable in the file with the value it starts with.
  const constants = new Map();
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) constants.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  };
  collect(source);
  // The value of a same-file variable an identifier reads, when it holds classes.
  const constantValue = (node) => {
    if (!ts.isIdentifier(node) || (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) return undefined;
    const value = constants.get(node.text);
    return value && (classValue(value) || ts.isConditionalExpression(value)) ? value : undefined;
  };
  // Every class list a className can produce: the two sides of `a ? b : c`
  // never apply together, and a same-file constant adds the classes it holds.
  const classLists = (node, seen = new Set()) => {
    if (!node) return [""];
    if (ts.isConditionalExpression(node)) return [...classLists(node.whenTrue, seen), ...classLists(node.whenFalse, seen)];
    const value = constantValue(node);
    // A constant that clashes by itself is reported where it is written.
    if (value) return seen.has(value) || clashesAlone(value, seen) ? [""] : classLists(value, new Set([...seen, value]));
    const children = node.getChildren(source);
    if (children.length === 0) return [node.getText(source)];
    return children.reduce((lists, child) => {
      const texts = classLists(child, seen);
      return lists.flatMap((list) => texts.map((text) => `${list} ${text}`));
    }, [""]);
  };
  // Whether a class value clashes by itself, wherever it is used.
  const clashesAlone = (node, seen = new Set()) => classValue(node) && classLists(node, new Set([...seen, node])).some((list) => clashes(list, false));
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
      if (whole && LOADING.test(node.text.trim()) && renderedInJsx(node)) report(node, "loading-text");
    }
    if (ts.isJsxText(node)) {
      if (DOT.test(node.text)) report(node, "dot-separator");
      if (LOADING.test(node.text.trim())) report(node, "loading-text");
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
  return [...plain.matchAll(/\{([^{}]*)\}/g)]
    .filter((rule) => cssClashes(rule[1]))
    .map((rule) => plain.slice(0, rule.index).split("\n").length)
    .filter((line) => !allowed(lines[line - 2], "animation-clash"))
    .map((line) => `${file}:${line} animation-clash: ${FIX["animation-clash"]}`);
});

// Copy shown in the app lives in messages/. Values are read decoded, so an
// escaped \u00b7 counts too; the line is the one that holds the key.
const copy = files("messages", [".json"]).flatMap((file) => {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const found = [];
  const walk = (value, name) => {
    if (typeof value === "string") {
      if (!DOT.test(value)) return;
      const line = lines.findIndex((entry) => entry.includes(`"${name}"`));
      found.push(`${file}:${line + 1} dot-separator: ${FIX["dot-separator"]}`);
    } else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) walk(inner, key);
    }
  };
  walk(JSON.parse(text), "");
  return found;
});

const problems = [...files("components", [".ts", ".tsx"]), ...files("app", [".ts", ".tsx"])].flatMap(check).concat(broad, stylesheets, stylesheetClashes, copy);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("UI rules hold: no animation clashes, uppercase labels, native title tooltips, dot separators, initials or Loading text.");
