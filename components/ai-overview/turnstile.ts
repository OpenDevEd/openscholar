"use client";

import { useCallback, useRef } from "react";
import { trackOverview } from "@/lib/posthog-overview";

// Cloudflare Turnstile, which shows a signed-out visitor is a person before their overview runs (#1070). Its widget
// stays out of sight unless Cloudflare needs the visitor to click: then it appears where the card puts its slot.
// developers.cloudflare.com/turnstile/get-started/client-side-rendering

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
/** The action the server checks a token was made for (lib/turnstile.ts). */
const ACTION = "overview";

type Options = {
  sitekey: string;
  action: string;
  execution: "execute";
  appearance: "interaction-only";
  size: "flexible";
  callback: (token: string) => void;
  "error-callback": () => boolean;
  "before-interactive-callback": () => void;
};
/** The card's widget, the slot it's in, and the token request it's answering. */
type Widget = { id: string; element: HTMLElement; waiting: { resolve: (token: string) => void; reject: (error: Error) => void } | null };
type Turnstile = { render: (element: HTMLElement, options: Options) => string; execute: (id: string) => void; reset: (id: string) => void; remove: (id: string) => void };
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | null = null;
function load() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile didn't start")));
    script.onerror = () => {
      loading = null;
      reject(new Error("Turnstile didn't load"));
    };
    document.head.append(script);
  });
  return loading;
}

/** A token asked for while the card's slot went away, unmounted or folded: nothing failed, so its overview just waits. */
export class TurnstileCancelled extends Error {}

/**
 * A slot for the widget, and `token()`, which asks Turnstile for a token: one use each, so one per overview, asked for
 * one at a time. Without a site key, as in a build that has none, there's nothing to ask and it fails.
 */
export function useTurnstile() {
  const element = useRef<HTMLDivElement | null>(null);
  const widget = useRef<Widget | null>(null);

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
      }
      if (element.current === node) element.current = null;
    };
  }, []);

  const one = useCallback(async () => {
    if (!SITE_KEY) throw new Error("No Turnstile site key in this build");
    const turnstile = await load();
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
            made.waiting?.resolve(value);
            made.waiting = null;
          },
          "error-callback": () => {
            trackOverview("overview_verification", { result: "failed" });
            made.waiting?.reject(new Error("Turnstile couldn't tell"));
            made.waiting = null;
            // Handled here, so Turnstile doesn't retry on its own.
            return true;
          },
          "before-interactive-callback": () => trackOverview("overview_verification", { result: "interactive" }),
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

  return { slot, token };
}
