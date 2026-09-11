"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Page headers share the app navigation offset and report their rendered height. */
export function StickyPageHeader({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const header = ref.current;
    const page = header?.parentElement;
    if (!header || !page) return;
    // Wrapped titles, actions and notices change the space the header occupies.
    const measure = () => page.style.setProperty("--page-header-height", `${header.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => {
      observer.disconnect();
      page.style.removeProperty("--page-header-height");
    };
  }, []);

  return (
    <div ref={ref} data-sticky-page-header className="sticky top-[var(--app-navbar-height)] z-20 border-b border-border/40 bg-background">
      <div className="container mx-auto max-w-6xl px-4 sm:px-6">{children}</div>
    </div>
  );
}
