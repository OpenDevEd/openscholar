/**
 * JSDOM layout stubs for TanStack Virtual tests.
 *
 * JSDOM has no layout engine. `@tanstack/react-virtual` reads
 * `offsetWidth` / `offsetHeight` on the scroll parent + row refs and
 * wires a `ResizeObserver` to react to size changes. Without stubs the
 * virtualizer sees a 0-height viewport and renders zero items.
 *
 * `installJsdomVirtualizerStubs()` gives the virtualizer:
 * - a 400px-tall viewport on the listbox element (anything with
 *   `data-sources-panel-list`),
 * - a 76px row height on every other element,
 * - a no-op `ResizeObserver` so size changes don't throw,
 *
 * and returns a `restore()` function to call in `afterEach` to put the
 * prototype back. Use the returned `VIRT_VIEWPORT_HEIGHT` / `VIRT_ROW_HEIGHT`
 * constants in assertions that depend on the same numbers.
 */
export const VIRT_VIEWPORT_HEIGHT = 400;
export const VIRT_ROW_HEIGHT = 76;

export function installJsdomVirtualizerStubs(): () => void {
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  const originalOffsetWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );
  const originalResizeObserver = globalThis.ResizeObserver;

  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute("data-sources-panel-list")) {
        return VIRT_VIEWPORT_HEIGHT;
      }
      return VIRT_ROW_HEIGHT;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 300;
    },
  });

  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  return () => {
    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        originalOffsetHeight,
      );
    }
    if (originalOffsetWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetWidth",
        originalOffsetWidth,
      );
    }
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  };
}
