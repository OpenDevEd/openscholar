/**
 * Test files that share modules also share a worker, one file after another. Whatever a file
 * changes in that worker is put back when it ends: its spies, its stubbed globals and
 * environment variables, and anything it set on process.env directly.
 */
import { afterAll, beforeAll, vi } from "vitest";

let env: NodeJS.ProcessEnv;
beforeAll(() => {
  env = { ...process.env };
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
});
