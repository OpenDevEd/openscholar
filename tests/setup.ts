// tests/setup.ts
// Source: https://testing-library.com/docs/react-testing-library/setup/

// Extend Vitest expect with jest-dom matchers (safe in all environments -- only extends expect)
import "@testing-library/jest-dom/vitest";

// Provide a dummy OpenRouter key so chat module imports don't explode
// on test initialisation. Real tests that actually call the provider
// should mock or overwrite this; most chat tests exercise the DB/auth
// path before the provider is touched.
process.env.OPENROUTER_API_KEY ??= "sk-or-test-key-for-vitest";

import { afterEach, vi } from "vitest";

// The page's workspace (#650): components act in one, which the app reads from the server.
// Component tests stand in for that read with one workspace; a test about another mocks this module itself.
vi.mock("@/lib/workspaces/url", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/workspaces/url")>();
  // Read when called: a test's own mock of convex/react may define only the hooks its component uses.
  const react = await import("convex/react");
  const workspaceId = "workspace_test";
  return {
    ...real,
    useWorkspace: () => workspaceId,
    // The person's own workspace, which a read names by leaving it out.
    useWorkspaceScope: () => ({}),
    useWorkspaceMutation: (mutation: Parameters<typeof react.useMutation>[0]) => {
      const run = react.useMutation(mutation);
      return (args: Record<string, unknown>) => run({ ...args, workspaceId });
    },
    useWorkspaceAction: (action: Parameters<typeof react.useAction>[0]) => {
      const run = react.useAction(action);
      return (args: Record<string, unknown>) => run({ ...args, workspaceId });
    },
  };
});

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

// JSDOM has no Web Animations either. The animated AI mark asks the document for its running animations;
// browser checks cover the motion, and component tests see none.
if (typeof Document !== "undefined" && typeof Document.prototype.getAnimations !== "function") {
  Document.prototype.getAnimations = () => [];
}
