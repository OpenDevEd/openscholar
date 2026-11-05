/**
 * ponytail: mock only. A profile's extra author IDs live in a cookie, author ID to profile ID, because the mock changes no
 * tables. The real build has a table of a profile's author IDs, with a migration moving today's `openalex` values across.
 */
export const MOCK_LINKS_COOKIE = "mock-author-links";

export type MockLinks = Record<string, string>;

export function parseLinks(value: string | undefined): MockLinks {
  try {
    return value ? (JSON.parse(decodeURIComponent(value)) as MockLinks) : {};
  } catch {
    return {};
  }
}

export const readLinks = (): MockLinks =>
  parseLinks(document.cookie.split("; ").find((cookie) => cookie.startsWith(`${MOCK_LINKS_COOKIE}=`))?.slice(MOCK_LINKS_COOKIE.length + 1));

export function writeLinks(links: MockLinks) {
  document.cookie = `${MOCK_LINKS_COOKIE}=${encodeURIComponent(JSON.stringify(links))}; path=/; max-age=31536000; samesite=lax`;
}

export const linksOf = (links: MockLinks, profileId: string) => Object.keys(links).filter((id) => links[id] === profileId);
