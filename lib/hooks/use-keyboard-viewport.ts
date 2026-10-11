"use client";

import { useSyncExternalStore } from "react";

/** The part of the page still visible above an on-screen keyboard, in page pixels. */
export type KeyboardViewport = { top: number; height: number };

let last: KeyboardViewport | null = null;

// Taller than any browser bar that comes and goes, shorter than any keyboard.
const KEYBOARD_MIN = 150;

function read(): KeyboardViewport | null {
  const view = window.visualViewport;
  // A pinch zoom shrinks the visible part too; only a keyboard shrinks it at scale 1.
  if (!view || view.scale > 1.01 || document.documentElement.clientHeight - view.height < KEYBOARD_MIN) return (last = null);
  if (last?.top !== view.offsetTop || last.height !== view.height) last = { top: view.offsetTop, height: view.height };
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
