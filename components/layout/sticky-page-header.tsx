"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Page headers share the app navigation offset and report their rendered height.
 * The border matches the sidebar's logo section, so the two top edges read as one line.
 */
export function StickyPageHeader({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  // A ResizeObserver and the window's resize: the header's size and the screen's height are the outside systems.
  useLayoutEffect(() => {
    const header = ref.current;
    const page = header?.parentElement;
    if (!header || !page) return;
    // Wrapped titles, actions and notices change the space the header occupies. Taller than half the screen under the
    // navigation (large text on a phone: 459px of a 568px screen on a configuration page, a paper's 741px), it scrolls
    // with the page instead of covering it, and takes no room from the page's sticky offsets.
    const measure = () => {
      const scrolls = header.offsetHeight > (window.innerHeight - parseFloat(getComputedStyle(header).top)) / 2;
      header.toggleAttribute("data-scrolls", scrolls);
      page.style.setProperty("--page-header-height", scrolls ? "0px" : `${header.offsetHeight}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      page.style.removeProperty("--page-header-height");
    };
  }, []);

  return (
    <div ref={ref} data-sticky-page-header className="sticky top-[var(--app-navbar-height)] z-20 border-b border-sidebar-border bg-background data-scrolls:static">
      <div className="container mx-auto max-w-6xl px-4 sm:px-6">{children}</div>
    </div>
  );
}
