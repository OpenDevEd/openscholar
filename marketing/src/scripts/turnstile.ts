// Cloudflare Turnstile's script, loaded once for whichever part of a page asks first: the contact form's token, or a
// search box earning the app's pass.
export type Turnstile = { render: (el: HTMLElement, o: Record<string, unknown>) => string; execute: (id: string) => void; reset: (id: string) => void; remove: (id: string) => void };

let loading: Promise<Turnstile> | null = null;
export const loadTurnstile = () => loading ??= new Promise<Turnstile>((resolve, reject) => {
  const w = window as unknown as { turnstile?: Turnstile };
  if (w.turnstile) return resolve(w.turnstile);
  const script = Object.assign(document.createElement("script"), { src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async: true });
  script.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error("Turnstile didn't start")));
  script.onerror = () => { loading = null; reject(new Error("Turnstile didn't load")); };
  document.head.append(script);
});
