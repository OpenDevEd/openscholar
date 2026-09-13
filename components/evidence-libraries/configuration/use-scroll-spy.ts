"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Async cards can grow above the destination after either a click or a reload.
// Follow that layout growth until the person next interacts with the page.
function followSectionLayout(target: HTMLElement) {
  const parent = target.parentElement;
  if (!parent) return () => {};
  let height = parent.getBoundingClientRect().height;
  const observer = new ResizeObserver(() => {
    const nextHeight = parent.getBoundingClientRect().height;
    if (nextHeight === height) return;
    height = nextHeight;
    document.getElementById(target.id)?.scrollIntoView({ behavior: "instant", block: "start" });
  });
  observer.observe(parent);
  const events = ["wheel", "pointerdown", "keydown"] as const;
  const stop = () => {
    observer.disconnect();
    for (const event of events) window.removeEventListener(event, stop, { capture: true });
  };
  for (const event of events) window.addEventListener(event, stop, { capture: true, passive: true });
  return stop;
}

/**
 * Which section is under the sticky header right now, plus a `jumpTo` that
 * scrolls to a section and keeps it highlighted until the scroll settles.
 *
 * Effect justification: window scroll position is an outside system with no
 * React value to derive from. Listeners are passive and removed on cleanup.
 * `ids` must be a stable array (a module constant) so the listener attaches once.
 * The active line follows each section's actual scroll margin.
 */
export function useScrollSpy(ids: readonly string[], requestedSection?: string) {
  const [active, setActive] = useState<string | null>(null);
  const locked = useRef<string | null>(null);
  const lastJump = useRef<string | null>(null);
  const stopFollowing = useRef<(() => void) | null>(null);
  const releaseJump = useRef<(() => void) | null>(null);

  const scrollTo = useCallback((id: string, behavior: ScrollBehavior = "smooth") => {
    const el = document.getElementById(`sec-${id}`);
    if (!el) return;
    releaseJump.current?.();
    stopFollowing.current?.();
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
    releaseJump.current = release;
    window.addEventListener("scrollend", release, { once: true });
    timer = window.setTimeout(release, 1200);
    el.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : behavior,
      block: "start",
    });
    stopFollowing.current = followSectionLayout(el);
  }, []);

  const jumpTo = useCallback((id: string) => {
    lastJump.current = id;
    scrollTo(id);
  }, [scrollTo]);

  // Restore URL destinations after the form mounts. Clicks already scrolled
  // smoothly, so consuming their URL update must not start a second scroll.
  useEffect(() => {
    if (!requestedSection || !ids.includes(requestedSection)) return;
    if (requestedSection !== lastJump.current) scrollTo(requestedSection, "instant");
    lastJump.current = null;
  }, [ids, requestedSection, scrollTo]);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (locked.current) return;
      let current: string | null = ids[0] ?? null;
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
      releaseJump.current?.();
      stopFollowing.current?.();
    };
  }, [ids]);

  return { active, jumpTo };
}
