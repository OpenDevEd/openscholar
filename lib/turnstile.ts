import "server-only";

/** The action a page names its overview token with, so a token made for anything else isn't taken for one. */
export const OVERVIEW_ACTION = "overview";
/** The action the contact form on openscholar.ai names its tokens with (app/api/contact). */
export const CONTACT_ACTION = "contact";

type Siteverify = { success: boolean; action?: string; hostname?: string; "error-codes"?: string[]; metadata?: { result_with_testing_key?: boolean } };

/**
 * Whether Cloudflare Turnstile says a token came from a person, for `action` (#1070). Checked on the server with the
 * widget's secret, as developers.cloudflare.com/turnstile/get-started/server-side-validation says: a token is good once
 * and for five minutes. Why it failed goes to the log.
 */
export async function verifyTurnstile(token: string, address: string, action: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("[turnstile] TURNSTILE_SECRET_KEY is not set");
    return false;
  }
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, ...(address === "unknown" ? {} : { remoteip: address }) }),
      signal: AbortSignal.timeout(10_000),
    });
    const answer = (await response.json()) as Siteverify;
    // Cloudflare's testing keys, which local runs use, name no action; production keys always do.
    if (answer.success && (answer.action === action || answer.metadata?.result_with_testing_key)) return true;
    console.warn(JSON.stringify({ event: "turnstile-refused", action, got: answer.action ?? null, codes: answer["error-codes"] ?? [] }));
    return false;
  } catch (error) {
    console.error("[turnstile] siteverify failed", error);
    return false;
  }
}
