import { describe, test, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * T4.0 substitute: the P3 plan asks for an ESLint `no-restricted-imports`
 * rule forbidding `@/convex/extraction/{mutations,queries}/*` from outside
 * `convex/extraction/`. This repository does not currently configure
 * ESLint, so this test implements the same invariant via a tree walk —
 * project-wide import scan, not a single-file source grep.
 *
 * Promote to a proper ESLint rule when the project adopts ESLint.
 */

const ROOT = path.resolve(__dirname, "../..");
const FORBIDDEN_PATTERNS = [
  /["']@\/convex\/extraction\/mutations\/[^"']+["']/,
  /["']@\/convex\/extraction\/queries\/[^"']+["']/,
];
// Relative imports from outside convex/extraction/ should also be blocked.
const FORBIDDEN_RELATIVE = [
  /["'](?:\.\.\/)+convex\/extraction\/mutations\/[^"']+["']/,
  /["'](?:\.\.\/)+convex\/extraction\/queries\/[^"']+["']/,
];

const SCAN_DIRS = [
  "app",
  "components",
  "hooks",
  "lib",
  "i18n",
  "messages",
  "scripts",
  "tests",
  "convex", // allowed to import from itself, filtered below
];

const IGNORE_SUFFIXES = [".d.ts"];

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (entry.name === "_generated") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx|mjs|js|jsx)$/.test(entry.name) &&
      !IGNORE_SUFFIXES.some((s) => entry.name.endsWith(s))) {
      out.push(full);
    }
  }
  return out;
}

function isInExtractionFolder(file: string): boolean {
  return path.relative(ROOT, file).startsWith(
    path.join("convex", "extraction")
  );
}

describe("T4.0 mutations/queries import boundary", () => {
  test("no file outside convex/extraction/ imports @/convex/extraction/{mutations,queries}/*", () => {
    const offenders: Array<{ file: string; line: string }> = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        if (isInExtractionFolder(file)) continue;
        const src = fs.readFileSync(file, "utf-8");
        const lines = src.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (FORBIDDEN_PATTERNS.some((p) => p.test(line))) {
            offenders.push({ file: path.relative(ROOT, file), line: line.trim() });
          }
          if (FORBIDDEN_RELATIVE.some((p) => p.test(line))) {
            offenders.push({ file: path.relative(ROOT, file), line: line.trim() });
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
