/**
 * The shield in front of Evidence Libraries answers 403 to a dynamic request without the cookie its browser check
 * sets, API routes included. OpenScholar's own server requests to a library carry it.
 */
export const LIBRARY_SHIELD_COOKIE = "ode_browser_check=1";

export function publicLibraryHeaders(accept: "application/json" | "text/html") {
  return { accept, cookie: LIBRARY_SHIELD_COOKIE };
}
