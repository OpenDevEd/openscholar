"use client";

import { useEffect, useState } from "react";

/**
 * Which section is under the sticky header right now.
 *
 * Effect justification: the browser scroll position is an outside system with
 * no React value to derive from. The listener is passive and removed on cleanup.
 * Pass a stable `ids` array (a module constant) so the listener is attached once.
 */
export function useScrollSpy(ids: readonly string[], headerOffset: number): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = headerOffset + 8;
      let current: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(`sec-${id}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = id;
        else break;
      }
      // At the very bottom the last section may never reach the line.
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
  }, [ids, headerOffset]);

  return active;
}
