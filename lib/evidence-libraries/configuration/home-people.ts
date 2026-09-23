/**
 * How a team member may appear on a library's home page. The runtime takes a
 * one-line name of at most 120 characters and an https photo address without
 * credentials, a fragment or HTML delimiters. An email is never a name: a
 * person with no name is left off the page.
 */
const NAME_MAX = 120;
const URL_MAX = 2048;

export function publicName(name: string | undefined): string | undefined {
  const line = (name ?? "").replace(/\s+/gu, " ").trim().slice(0, NAME_MAX).trim();
  return line || undefined;
}

export function publicPhoto(url: string | undefined): string | undefined {
  if (!url || url.length > URL_MAX || /[<>]/u.test(url) || !URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash ? url : undefined;
}
