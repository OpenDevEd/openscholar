import { CITATION_FORMATS, type CitationStyle } from "./formats";

export async function loadCitationStyles(): Promise<CitationStyle[]> {
  const { default: styles } = await import("./assets/catalog.json");
  return [...CITATION_FORMATS, ...styles];
}

export function searchCitationStyles(
  styles: readonly CitationStyle[],
  query: string,
): CitationStyle[] {
  const words = query
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [...styles];
  return styles.filter((style) => {
    const text = `${style.label} ${style.id}`
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "");
    return words.every((word) => text.includes(word));
  });
}

export type CitationStyleAssets = {
  styles: Record<string, unknown>;
  locales: Record<string, unknown>;
};
const downloads = new Map<string, Promise<CitationStyleAssets>>();

/** Failed downloads are evicted so the visible retry action makes a new attempt. */
export function loadCitationStyleAssets(
  asset: string,
): Promise<CitationStyleAssets> {
  const cached = downloads.get(asset);
  if (cached) return cached;
  const pending = fetch(asset, { cache: "force-cache" })
    .then(async (response) => {
      if (!response.ok || !response.body)
        throw new Error("Citation style download failed");
      return new Response(
        response.body.pipeThrough(new DecompressionStream("gzip")),
      ).json() as Promise<CitationStyleAssets>;
    })
    .catch((error) => {
      downloads.delete(asset);
      throw error;
    });
  downloads.set(asset, pending);
  return pending;
}
