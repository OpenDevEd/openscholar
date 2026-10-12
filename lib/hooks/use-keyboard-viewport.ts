"use client";

import { useSyncExternalStore } from "react";

/** The part of the page still visible above an on-screen keyboard: its top, and its bottom measured up from the foot of the screen, in CSS pixels as `position: fixed` reads them. */
export type KeyboardViewport = { top: number; bottom: number };

let last: KeyboardViewport | null = null;

// Taller than any browser bar that comes and goes, shorter than any keyboard.
const KEYBOARD_MIN = 150;

function read(): KeyboardViewport | null {
  const view = window.visualViewport;
  // Safari's innerHeight shrinks with the keyboard; the layout viewport's height doesn't.
  const layout = document.documentElement.clientHeight;
  // A pinch zoom shrinks the visible part too; only a keyboard shrinks it at scale 1.
  if (!view || view.scale > 1.01 || layout - view.height < KEYBOARD_MIN) return (last = null);
  const bottom = layout - view.offsetTop - view.height;
  if (last?.top !== view.offsetTop || last.bottom !== bottom) last = { top: view.offsetTop, bottom };
  return last;
}

function subscribe(onChange: () => void) {
  const view = window.visualViewport;
  view?.addEventListener("resize", onChange);
  view?.addEventListener("scroll", onChange);
  return () => {
    view?.removeEventListener("resize", onChange);
    view?.removeEventListener("scroll", onChange);
  };
}

/**
 * Where the page is visible while an on-screen keyboard is up, or null when none is. Safari keeps the
 * page its full height under the keyboard and pans it to show the field being typed in, so a panel
 * fixed to the screen needs this to stay on screen.
 */
export function useKeyboardViewport() {
  return useSyncExternalStore(subscribe, read, () => null);
}
