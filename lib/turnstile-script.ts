// Cloudflare Turnstile's script, loaded once for whatever asks first: a signed-out overview's token
// (components/ai-overview/turnstile.ts) or a browser's pass (lib/visitor-pass.ts).
// developers.cloudflare.com/turnstile/get-started/client-side-rendering

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export type TurnstileOptions = {
  sitekey: string;
  action: string;
  appearance: "interaction-only";
  execution?: "execute";
  size?: "flexible";
  theme?: "light" | "dark";
  callback: (token: string) => void;
  "error-callback": () => boolean;
  "before-interactive-callback"?: () => void;
  /** The visitor left the checkbox unticked for two minutes. Turnstile says so only here: a widget run by `execute` then goes quiet, with no error and no token. */
  "timeout-callback"?: () => void;
};
export type Turnstile = { render: (element: HTMLElement, options: TurnstileOptions) => string; execute: (id: string) => void; reset: (id: string) => void; remove: (id: string) => void };
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | null = null;
export function loadTurnstile() {
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
