"use client";

import { useCallback, useRef, useState } from "react";
import { trackOverview } from "@/lib/posthog-overview";
import { loadTurnstile } from "@/lib/turnstile-script";

// Cloudflare Turnstile, which shows a signed-out visitor is a person before their overview runs (#1070). Its widget
// stays out of sight unless Cloudflare needs the visitor to click: then it appears where the card puts its slot.
// developers.cloudflare.com/turnstile/get-started/client-side-rendering

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
/** The action the server checks a token was made for (lib/turnstile.ts). */
const ACTION = "overview";

/** The card's widget, the slot it's in, and the token request it's answering. */
type Widget = { id: string; element: HTMLElement; waiting: { resolve: (token: string) => void; reject: (error: Error) => void } | null };

/** A token asked for while the card's slot went away, unmounted or folded: nothing failed, so its overview just waits. */
export class TurnstileCancelled extends Error {}

/**
 * A slot for the widget, and `token()`, which asks Turnstile for a token: one use each, so one per overview, asked for
 * one at a time. Without a site key, as in a build that has none, there's nothing to ask and it fails. `asking` is
 * true while Cloudflare's checkbox is showing in the slot, waiting for the visitor.
 */
export function useTurnstile() {
  const element = useRef<HTMLDivElement | null>(null);
  const widget = useRef<Widget | null>(null);
  const [asking, setAsking] = useState(false);

  // The widget is Cloudflare's and lives in this slot: it goes when the slot does, and a token it was making with it.
  const slot = useCallback((node: HTMLDivElement | null) => {
    element.current = node;
    if (!node) return;
    return () => {
      const made = widget.current;
      if (made?.element === node) {
        window.turnstile?.remove(made.id);
        made.waiting?.reject(new TurnstileCancelled("The overview's slot went away"));
        widget.current = null;
        setAsking(false);
      }
      if (element.current === node) element.current = null;
    };
  }, []);

  const one = useCallback(async () => {
    if (!SITE_KEY) throw new Error("No Turnstile site key in this build");
    const turnstile = await loadTurnstile();
    const slotted = element.current;
    if (!slotted) throw new TurnstileCancelled("The overview's slot isn't there");
    return await new Promise<string>((resolve, reject) => {
      if (!widget.current) {
        const made: Widget = { id: "", element: slotted, waiting: null };
        made.id = turnstile.render(slotted, {
          sitekey: SITE_KEY,
          action: ACTION,
          execution: "execute",
          appearance: "interaction-only",
          size: "flexible",
          callback: (value) => {
            setAsking(false);
            made.waiting?.resolve(value);
            made.waiting = null;
          },
          "error-callback": () => {
            setAsking(false);
            trackOverview("overview_verification", { result: "failed" });
            made.waiting?.reject(new Error("Turnstile couldn't tell"));
            made.waiting = null;
            // Handled here, so Turnstile doesn't retry on its own.
            return true;
          },
          "before-interactive-callback": () => {
            setAsking(true);
            trackOverview("overview_verification", { result: "interactive" });
          },
          // Left unticked for two minutes, the checkbox goes and Turnstile says nothing more: without this the overview
          // waited for good, and every lens after it waited behind it.
          "timeout-callback": () => {
            setAsking(false);
            trackOverview("overview_verification", { result: "failed" });
            made.waiting?.reject(new Error("Turnstile's check went unanswered"));
            made.waiting = null;
          },
        });
        widget.current = made;
      } else turnstile.reset(widget.current.id);
      widget.current.waiting = { resolve, reject };
      turnstile.execute(widget.current.id);
    });
  }, []);
  // One widget makes one token at a time: lenses opened in a row wait their turn.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const token = useCallback(() => {
    const next = queue.current.catch(() => undefined).then(one);
    queue.current = next;
    return next;
  }, [one]);

  return { slot, token, asking };
}
