import type { KeyboardEvent } from "react";

const STEP: Partial<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * The ARIA radio group's keys, for a radiogroup of buttons: an arrow moves to the next or
 * previous radio, round the ends, and picks it. Pair it with `radioTabIndex`, so Tab stops on
 * the group once.
 */
export function radioKeys(event: KeyboardEvent<HTMLElement>) {
  const step = STEP[event.key];
  if (!step) return;
  const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')];
  const at = radios.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  event.preventDefault();
  const next = radios[(at + step + radios.length) % radios.length];
  next.focus();
  next.click();
}

/** Tab reaches the picked radio, or the first while none is picked. */
export const radioTabIndex = (on: boolean, index: number, anyOn: boolean) => (on || (!anyOn && index === 0) ? 0 : -1);
