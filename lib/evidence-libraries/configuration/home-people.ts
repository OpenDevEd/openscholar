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
  if (!url || /[<>]/u.test(url)) return undefined;
  // Not URL.canParse: Convex's query runtime does not have it.
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  const accepted = parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash;
  return accepted && parsed.href.length <= URL_MAX ? parsed.href : undefined;
}

/**
 * People written into the Home card by hand, rather than chosen from the
 * library's OpenScholar team, carry ids with this prefix. They need no account;
 * their name and photo are the ones the owner typed.
 */
export const HAND_ENTERED_PREFIX = "custom";

export function isHandEntered(id: string): boolean {
  return id.startsWith(`${HAND_ENTERED_PREFIX}_`);
}

/**
 * The square taken from a photo: the full width or height, whichever is
 * shorter. A portrait keeps its upper part, where the face usually is; a
 * landscape keeps its middle.
 */
export function squareCrop(width: number, height: number) {
  const side = Math.min(width, height);
  return {
    side,
    x: Math.round((width - side) / 2),
    y: Math.round((height - side) * 0.2),
  };
}
