/** A paper page's ID: one of our index (OS…) or an OpenAlex work (W…), which redirects to ours. */
const PAGE_ID = /^(OS|W)(\d+)$/i;

/** The bare ID a paper page takes, upper-cased, or null for anything else. */
export function paperPageId(raw: string): string | null {
  const match = PAGE_ID.exec(decodeURIComponent(raw).trim().split("/").at(-1) ?? "");
  return match ? `${match[1]!.toUpperCase()}${match[2]}` : null;
}

/** The words of a title as they read in an address: letters and digits of any script, joined by dashes, cut at a word. */
export function paperSlug(title: string | null | undefined): string {
  const words = (title ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  let slug = "";
  for (const word of words) {
    if (slug && slug.length + word.length + 1 > 80) break;
    slug = slug ? `${slug}-${word}` : word.slice(0, 80);
  }
  return slug;
}

/** A paper page's own address: its ID, then its title's words when it has any. */
export function paperPath(id: string, title: string | null | undefined): string {
  const slug = paperSlug(title);
  return slug ? `/papers/${id}/${slug}` : `/papers/${id}`;
}
