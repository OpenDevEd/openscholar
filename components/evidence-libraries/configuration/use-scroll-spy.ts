"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Which section is under the sticky header right now, plus a `jumpTo` that
 * scrolls to a section and keeps it highlighted until the scroll settles.
 *
 * Effect justification: window scroll position is an outside system with no
 * React value to derive from. Listeners are passive and removed on cleanup.
 * `ids` must be a stable array (a module constant) so the listener attaches once.
 * The active line follows each section's actual scroll margin.
 */
export function useScrollSpy(ids: readonly string[]) {
  const [active, setActive] = useState<string | null>(null);
  const locked = useRef<string | null>(null);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (locked.current) return;
      let current: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(`sec-${id}`);
        if (!el) continue;
        const line = Number.parseFloat(getComputedStyle(el).scrollMarginTop) + 8;
        if (el.getBoundingClientRect().top <= line) current = id;
        else break;
      }
      const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
      if (atBottom) current = ids[ids.length - 1] ?? current;
      setActive((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ids]);

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(`sec-${id}`);
    if (!el) return;
    locked.current = id;
    setActive(id);
    let timer = 0;
    const release = () => {
      window.removeEventListener("scrollend", release);
      window.clearTimeout(timer);
      locked.current = null;
    };
    // `scrollend` fires when the smooth scroll settles; the timeout covers
    // browsers without it and the case where nothing needs to scroll.
    window.addEventListener("scrollend", release, { once: true });
    timer = window.setTimeout(release, 1200);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return { active, jumpTo };
}
