/** The query parameter a page reads when a Zotero sign-in that started on it didn't finish. */
export const ZOTERO_SIGN_IN_ERROR = "zotero_error";

/**
 * Where Zotero's callback sends the person: back to the page the sign-in started on, or to
 * Connections in Settings when that isn't known, with `ZOTERO_SIGN_IN_ERROR` only when it failed.
 */
export function zoteroReturnUrl(appUrl: string, { returnTo, error }: { returnTo?: string; error?: string }) {
  const url = new URL(`${appUrl}${returnTo ?? "/settings/connections"}`);
  url.searchParams.delete(ZOTERO_SIGN_IN_ERROR);
  if (error) url.searchParams.set(ZOTERO_SIGN_IN_ERROR, error);
  return url.toString();
}
