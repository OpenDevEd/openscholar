"use client";

import { loadTurnstile } from "@/lib/turnstile-script";

// Cloudflare answers a signed-out browser's server actions only once the browser holds its pass, the `cf_clearance`
// cookie a solved challenge leaves (docs/agents/project.md, "Bot floods"). Pages themselves are never checked, so the
// first search, or a paper page's lists, is where a browser without the pass is stopped: the request comes back as a
// challenge page marked `cf-mitigated: challenge`
// (developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response). Turnstile then
// earns the pass out of sight, and the request goes again. A browser that can't earn it gets the challenge page as
// its answer, which the action's caller shows as any failed request.

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Fetch = typeof fetch;

/** `plain`, sending a request Cloudflare challenged once more after `earn` gets the browser its pass. Requests challenged together wait for one pass. */
export function withPass(plain: Fetch, earn: () => Promise<void>): Fetch {
  let earning: Promise<boolean> | null = null;
  return async (input, init) => {
    const response = await plain(input, init);
    // Only a request that can be sent twice goes again: one given as an address, with a body that isn't a stream. Server actions are.
    if (response.headers.get("cf-mitigated") !== "challenge" || input instanceof Request || init?.body instanceof ReadableStream) return response;
    earning ??= earn().then(() => true, () => false).finally(() => { earning = null; });
    return (await earning) ? plain(input, init) : response;
  };
}

/**
 * Earns the pass. Turnstile's widget stays out of sight unless Cloudflare wants a click: then its checkbox takes the
 * middle of the window, over the page dimmed as a dialog dims it, until it's ticked. A click on the dimmed page or
 * Escape sends it away without the pass, and whatever asked for it fails as it would offline.
 *
 * ponytail: the checkbox isn't inside a dialog that's open, so a click on it closes that dialog. A pass is earned
 * as a page loads, before anything opens; give it a place inside the dialog if a search in one ever needs the click.
 */
async function earnPass() {
  if (!SITE_KEY) throw new Error("No Turnstile site key in this build");
  const turnstile = await loadTurnstile();
  const host = document.createElement("div");
  host.className = "pointer-events-none fixed inset-0 z-100 flex items-center justify-center";
  const slot = host.appendChild(document.createElement("div"));
  document.body.append(host);
  let widget = "";
  const left = new AbortController();
  try {
    await new Promise<void>((resolve, reject) => {
      widget = turnstile.render(slot, {
        sitekey: SITE_KEY,
        action: "pass",
        appearance: "interaction-only",
        theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
        callback: () => resolve(),
        "error-callback": () => {
          reject(new Error("Turnstile couldn't tell"));
          // Handled here, so Turnstile doesn't retry on its own.
          return true;
        },
        "before-interactive-callback": () => {
          host.className = "fade-enter fixed inset-0 z-100 flex items-center justify-center bg-black/50";
          slot.className = "rounded-lg border bg-background p-4 shadow-lg outline-none";
          // Focus comes to the checkbox's frame, so Tab reaches it next.
          slot.tabIndex = -1;
          slot.focus();
          const leave = () => reject(new Error("The check was sent away"));
          host.addEventListener("click", (event) => { if (event.target === host) leave(); }, { signal: left.signal });
          document.addEventListener("keydown", (event) => { if (event.key === "Escape") leave(); }, { signal: left.signal });
        },
      });
    });
  } finally {
    left.abort();
    if (widget) turnstile.remove(widget);
    host.remove();
  }
}

declare global {
  interface Window {
    /** Set once `fetch` earns the pass when challenged, so a module loaded twice wraps it once. */
    earnsPass?: true;
  }
}

// Installed as the app's first client code loads, before anything can send a server action. Next's router sends them
// through `window.fetch` as it stands at the time (next/dist/client/components/segment-cache/fetch.js).
if (typeof window !== "undefined" && !window.earnsPass) {
  window.earnsPass = true;
  window.fetch = withPass(window.fetch.bind(window), earnPass);
}
