// tests/setup.ts
// Source: https://testing-library.com/docs/react-testing-library/setup/

// Extend Vitest expect with jest-dom matchers (safe in all environments -- only extends expect)
import "@testing-library/jest-dom/vitest";

// Provide a dummy OpenRouter key so chat module imports don't explode
// on test initialisation. Real tests that actually call the provider
// should mock or overwrite this; most chat tests exercise the DB/auth
// path before the provider is touched.
process.env.OPENROUTER_API_KEY ??= "sk-or-test-key-for-vitest";

import { afterEach } from "vitest";

// Cleanup React Testing Library renders after each test
// Only runs when a DOM environment is active (jsdom)
afterEach(async () => {
  if (typeof globalThis.document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
