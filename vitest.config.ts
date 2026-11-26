import { defineConfig } from "vitest/config";
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import path from "path";

const domTests = [
  "tests/hooks/**/*.test.{ts,tsx}",
  "tests/components/**/*.test.tsx",
  "tests/a11y/**/*.test.tsx",
  "app/**/__tests__/**/*.test.tsx",
  "tests/*.test.tsx",
];

/** Whether a test file replaces a module with vi.mock, itself or through a local file it imports. */
function mocksModules(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const source = readFileSync(file, "utf8");
  if (/\bvi\.(mock|doMock)\(/.test(source)) return true;
  return [...source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)].some(([, specifier]) => {
    const base = path.join(path.dirname(file), specifier);
    const local = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    return local !== undefined && mocksModules(local, seen);
  });
}

type Project = { name: string; environment: string; include: string[]; exclude?: string[]; setupFiles?: string[] };

/**
 * Files that share one module graph per worker, which saves importing every module again for
 * each file: about half of the suite's CPU. A file that mocks a module runs in an isolated
 * twin project instead, since another file may already have loaded the real module.
 */
function sharingModules(project: Project) {
  const mocking = globSync(project.include, { exclude: project.exclude ?? [] }).filter((file) => mocksModules(file));
  return [
    { test: { ...project, isolate: false, exclude: [...(project.exclude ?? []), ...mocking], setupFiles: [...(project.setupFiles ?? []), "./tests/shared-worker.ts"] } },
    { test: { ...project, name: `${project.name}-mocks`, include: mocking } },
  ];
}

// Component tests mock modules in almost every file, so they keep a module graph each, in the
// VM contexts of vmThreads: cheaper than a fresh worker per file. Two kinds of file need a real
// worker and run in forks: code that calls Node's webcrypto, which refuses typed arrays made in
// a VM context, and code that loads html-react-parser, whose CommonJS build requires an ES
// module, which a VM context can't.
const workerTests = ["tests/components/library-page-client.test.tsx", "tests/citation-text.test.tsx"];

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, ".") },
      // Every Convex test runs under Convex's transaction limits (#350).
      { find: /^convex-test$/, replacement: path.resolve(__dirname, "tests/convex-test-with-limits.ts") },
      // The cached hooks read through convex/react in tests (tests/convex-cache-hooks.ts).
      { find: /^convex-helpers\/react\/cache\/hooks$/, replacement: path.resolve(__dirname, "tests/convex-cache-hooks.ts") },
    ],
  },
  test: {
    projects: [
      ...sharingModules({ name: "convex", environment: "edge-runtime", include: ["convex/**/*.test.ts"], setupFiles: ["./tests/convex-timers.ts"] }),
      { test: { name: "dom", environment: "jsdom", include: domTests, exclude: workerTests, pool: "vmThreads" } },
      { test: { name: "dom-workers", environment: "jsdom", include: workerTests } },
      ...sharingModules({ name: "node", environment: "node", include: ["tests/**/*.test.{ts,tsx}", "lib/**/*.test.ts"], exclude: [...domTests, "tests/live-billing/**"] }),
      // What functions read at full size (#631): `npm run bench` only, never in `npm test`, since it seeds jobs of 50,000 papers.
      ...(process.env.BENCH ? [{ test: { name: "bench", environment: "edge-runtime", include: ["convex/bench/**/*.bench.ts"], testTimeout: 1_800_000, hookTimeout: 1_800_000, fileParallelism: false } }] : []),
    ],
    server: {
      deps: {
        // Required for convex-test's dynamic module loading
        inline: ["convex-test"],
      },
    },
    setupFiles: ["./tests/setup.ts"],
    tags: [
      {
        name: "size",
        description: "Seeds the largest sizes the product allows (#350), or enough rows to cross a page or batch. Over half of the suite's CPU, so `npm test` leaves these out and CI runs them nightly (`npm run test:size`).",
        timeout: 600_000,
      },
    ],
    // CI runs these beside three Next.js builds on the same machine. A jsdom
    // test that takes a second or two alone, such as rendering 950 bucket
    // rows, then ran past Vitest's default of five seconds.
    testTimeout: 30_000,
    // The size tag gives a test ten minutes, but a tag can't set a hook's limit. A size run gives
    // hooks the same, so the cleanup after a big case isn't cut off at Vitest's ten seconds.
    hookTimeout: process.argv.includes("--tags-filter=size") ? 600_000 : undefined,
  },
});
