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

// JSDOM lacks Element#scrollIntoView; the keyboard navigation hook
// (use-transactions-keyboard) calls it after every arrow keypress.
// Polyfill once globally so tests don't have to spy per-element.
if (typeof globalThis.Element !== "undefined") {
  const proto = globalThis.Element.prototype as Element & {
    scrollIntoView?: (arg?: boolean | ScrollIntoViewOptions) => void;
  };
  if (typeof proto.scrollIntoView !== "function") {
    proto.scrollIntoView = function scrollIntoViewPolyfill() {
      // no-op — JSDOM has no layout engine
    };
  }
}

// JSDOM lacks ResizeObserver; Radix Switch and Checkbox read it when they
// render inside a <form>. Polyfill a no-op once globally.
if (
  typeof globalThis.window !== "undefined" &&
  typeof globalThis.ResizeObserver === "undefined"
) {
  globalThis.ResizeObserver = class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Cleanup React Testing Library renders after each test
// Only runs when a DOM environment is active (jsdom)
afterEach(async () => {
  if (typeof globalThis.document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});

// JSDOM has no media-query engine. Browser tests cover responsive layout and
// reduced motion; component tests default to no matching media queries.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (media: string): MediaQueryList => ({
    matches: false,
    media,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
  });
}
