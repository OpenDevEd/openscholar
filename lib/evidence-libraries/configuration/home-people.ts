/**
 * How a team member may appear on a library's home page. The runtime takes a
 * one-line name of at most 120 characters and an https photo address without
 * credentials, a fragment or HTML delimiters. An email is never a name: a
 * person with no name is left off the page.
 */
const NAME_MAX = 120;
const URL_MAX = 2048;

export function publicName(name: string | undefined): string | undefined {
  // Whitespace of any kind becomes one space; other control characters, which the runtime refuses, go.
  const line = (name ?? "")
    .replace(/\s+/gu, " ")
    .replace(/[\u0000-\u001F\u007F]/gu, "")
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return line || undefined;
}

/** The photo's address as the runtime will validate it: parsed and written out in its canonical, encoded form. */
export function publicPhoto(url: string | undefined): string | undefined {
  if (!url || /[<>]/u.test(url) || !URL.canParse(url.trim())) return undefined;
  const parsed = new URL(url.trim());
  const accepted = parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash;
  return accepted && parsed.href.length <= URL_MAX ? parsed.href : undefined;
}
