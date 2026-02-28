// tests/setup.ts
// Source: https://testing-library.com/docs/react-testing-library/setup/

// Extend Vitest expect with jest-dom matchers (safe in all environments -- only extends expect)
import "@testing-library/jest-dom/vitest";

import { afterEach } from "vitest";

// Cleanup React Testing Library renders after each test
// Only runs when a DOM environment is active (jsdom)
afterEach(async () => {
  if (typeof globalThis.document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
