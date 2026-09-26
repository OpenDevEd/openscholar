#!/usr/bin/env node

// Lint: an element that is animated (a CSS animation class or Framer props)
// must not also transition opacity or transform. The two fight over the same
// property: Firefox then jumps back and forth as an animation ends, and a
// Framer layout animation wobbles. Tailwind's bare `transition` covers opacity
// and transform too, so only explicit property lists are safe on animated
// elements. Shared `components/ui` parts name the properties they transition,
// so animating one is safe.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const TRANSITION = /(?:^|[\s"'`])(?:[\w-]+:)*transition(?:-all|-opacity|-transform)?(?=$|[\s"'`])/;
const BROAD_TRANSITION = /(?:^|[\s"'`])(?:[\w-]+:)*transition(?:-all)?(?=$|[\s"'`])/;
const CSS_ANIMATION = /(?:^|[\s"'`])(?:[\w[\]=-]+:)*(animate-in|animate-out|fade-enter|animate-(?!none|spin|pulse|ping|bounce)[\w[\]-]+)/;
const FRAMER_PROPS = new Set(["initial", "animate", "exit", "layout", "layoutId", "variants", "whileHover", "whileTap", "whileInView", "whileFocus", "whileDrag"]);

function tsxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? tsxFiles(file) : file.endsWith(".tsx") ? [file] : [];
  });
}

function clashes(file) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      let className = "";
      let framer = false;
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(source);
        if (name === "className" && attribute.initializer) className = attribute.initializer.getText(source);
        if (FRAMER_PROPS.has(name) && tag.startsWith("motion.")) framer = true;
      }
      if (TRANSITION.test(className) && (framer || CSS_ANIMATION.test(className))) {
        found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} <${tag}> animates and transitions opacity or transform`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const broad = tsxFiles("components/ui").flatMap((file) =>
  readFileSync(file, "utf8").split("\n").flatMap((line, index) =>
    BROAD_TRANSITION.test(line) ? [`${file}:${index + 1} shared part uses transition or transition-all`] : []));

const problems = [...tsxFiles("components"), ...tsxFiles("app")].flatMap(clashes).concat(broad);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("No animation and transition clashes.");
