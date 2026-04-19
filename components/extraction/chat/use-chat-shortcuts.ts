"use client";

import { useEffect } from "react";

/**
 * Wires global keyboard shortcuts on the chat page:
 *
 *   ⌘K (or Ctrl+K) — focus the composer textarea
 *   Esc when textarea is focused and empty — blur the textarea
 *
 * No-op when the user is typing in another input/textarea/contenteditable
 * so we don't hijack form fields elsewhere on the page.
 */
export function useChatShortcuts() {
  useEffect(() => {
    function isTextEntry(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.dataset.chatComposer) return false; // composer itself is OK to interact with
      if (target.closest("[data-chat-composer]")) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      if (target.isContentEditable) return true;
      return false;
    }

    function focusComposer() {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-chat-composer] textarea',
      );
      textarea?.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      // ⌘K / Ctrl+K → focus composer (universal jump)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        if (isTextEntry(e.target)) return;
        e.preventDefault();
        focusComposer();
        return;
      }

      // Esc on the empty composer → blur (lets users dismiss focus)
      if (e.key === "Escape") {
        const target = e.target;
        if (
          target instanceof HTMLTextAreaElement &&
          target.closest("[data-chat-composer]") &&
          target.value.length === 0
        ) {
          target.blur();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
