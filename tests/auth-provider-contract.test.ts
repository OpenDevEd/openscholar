import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BLOCKED_PROVIDER_TOKENS = [
  ["work", "os"].join(""),
  "@work" + "os-inc",
  "Auth" + "Kit",
  "WORK" + "OS_",
];
const EXCLUDED_PREFIXES = ["node_modules/", "convex/_generated/"];
const EXCLUDED_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".pdf",
  ".zip",
];

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const DISALLOWED = new RegExp(
  `(${BLOCKED_PROVIDER_TOKENS.map((token) => escapeRegExp(token)).join("|")})`,
  "i",
);

function listTrackedFiles(): string[] {
  const output = execSync("git ls-files", {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return output.split("\n").filter(Boolean);
}

function shouldSkip(relativePath: string): boolean {
  if (EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
    return true;
  }
  return EXCLUDED_EXTENSIONS.some((ext) => relativePath.endsWith(ext));
}

describe("auth provider contract", () => {
  it("contains no blocked provider references in tracked files", () => {
    const violations: string[] = [];

    for (const relativePath of listTrackedFiles()) {
      if (shouldSkip(relativePath)) {
        continue;
      }

      const absolutePath = path.resolve(process.cwd(), relativePath);
      let content: string;
      try {
        content = readFileSync(absolutePath, "utf8");
      } catch {
        continue;
      }

      if (DISALLOWED.test(content)) {
        violations.push(relativePath);
      }
    }

    expect(violations).toEqual([]);
  });
});
