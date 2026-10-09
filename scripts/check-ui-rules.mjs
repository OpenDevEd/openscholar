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
// another box. new-el runs the same rules (tools/uiRules.ts); keep them in step.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
// TypeScript 7 ships no JavaScript API until 7.1, so this script parses with TypeScript 6.
import ts from "typescript6";

// Bare `transition` and `transition-all` cover opacity and transform too; an
// arbitrary list counts when it names either.
const TRANSITION = /(?:^|[\s"'`])(?:[\w-]+:)*transition(?:-all|-opacity|-transform|-\[[^\]]*(?:opacity|transform|translate|scale|rotate|all)[^\]]*\])?(?=$|[\s"'`])/;
const BROAD_TRANSITION = /(?:^|[\s"'`])(?:[\w-]+:)*transition(?:-all)?(?=$|[\s"'`])/;
// Every animation counts, the built-in spin, pulse, ping and bounce too: they
// animate transform or opacity.
const CSS_ANIMATION = /(?:^|[\s"'`])(?:[\w[\]=-]+:)*(fade-enter|animate-(?!none(?=$|[\s"'`]))[\w[\]-]+)/;
// Variants that style a pseudo-element, a different box from the element itself.
const PSEUDO_ELEMENT = /(^|:)(before|after|placeholder|file|marker|selection|first-letter|first-line|backdrop):/;
/** A class list without the classes that style a pseudo-element. */
const ownClasses = (classes) => classes.split(/[\s"'`{}]+/).filter((token) => !PSEUDO_ELEMENT.test(token)).join(" ");
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
      let className = "";
      let framer = false;
      let style = "";
      let title = null;
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(source);
        if (name === "className" && attribute.initializer) className = attribute.initializer.getText(source);
        if (name === "style" && attribute.initializer) style = attribute.initializer.getText(source);
        if (FRAMER_PROPS.has(name) && tag.startsWith("motion.")) framer = true;
        if (name === "title") title = attribute;
        if (tag === "AvatarFallback" && name === "children" && attribute.initializer && rendersText(attribute.initializer)) report(attribute, "initials");
      }
      const own = ownClasses(className);
      if (TRANSITION.test(own) && (framer || CSS_ANIMATION.test(own))) report(node, "animation-clash");
      // Built-in elements only; an iframe's title is its accessible name, and
      // the hidden Z3988 spans carry citation data for Zotero.
      const coins = tag === "span" && /(?:^|[\s"'`])Z3988(?=$|[\s"'`])/.test(className) && /display:\s*["']none["']/.test(style);
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
const stylesheets = scanLines([...files("app", [".css"]), ...files("components", [".css"])], UPPERCASE_CSS, "uppercase", FIX.uppercase);

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

const problems = [...files("components", [".ts", ".tsx"]), ...files("app", [".ts", ".tsx"])].flatMap(check).concat(broad, stylesheets, copy);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("UI rules hold: no animation clashes, uppercase labels, native title tooltips, dot separators, initials or Loading text.");
