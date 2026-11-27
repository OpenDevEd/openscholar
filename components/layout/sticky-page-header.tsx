"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Page headers share the app navigation offset and report their rendered height.
 * The border matches the sidebar's logo section, so the two top edges read as one line.
 */
/** `wide` drops the site's 72rem strip, for a page that works across the whole window (the open screening). */
export function StickyPageHeader({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  // A ResizeObserver and the window's resize: the header's size and the screen's height are the outside systems.
  useLayoutEffect(() => {
    const header = ref.current;
    const page = header?.parentElement;
    if (!header || !page) return;
    // Wrapped titles, actions and notices change the space the header occupies. On a phone (under Tailwind's `sm`), taller
    // than half the screen under the navigation (large text: 459px of a 568px screen on a configuration page, a paper's
    // 741px), it scrolls with the page instead of covering it, and takes no room from the page's sticky offsets. Desktop
    // bars stay sticky at any height.
    const phone = window.matchMedia("(width < 40rem)");
    const measure = () => {
      const scrolls = phone.matches && header.offsetHeight > (window.innerHeight - parseFloat(getComputedStyle(header).top)) / 2;
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
      {/* As wide as a wide page under it (components/evidence-libraries/library-page-shell.tsx), so their left edges stay together. */}
      <div className={wide ? "mx-auto max-w-[85rem] px-4 sm:px-6" : "container mx-auto max-w-6xl px-4 sm:px-6"}>{children}</div>
    </div>
  );
}
