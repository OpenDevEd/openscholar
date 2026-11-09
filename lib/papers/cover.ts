/** The title pages a paper without a picture of its own first page can wear. */
export const COVER_KINDS = ["journal", "preprint", "report", "monograph", "bulletin"] as const;
export type CoverKind = (typeof COVER_KINDS)[number];

/** The ink a title page is printed in, beside the brand's orange. */
const COVER_INKS = ["#e8761c", "#1f7a6d", "#3b4fa8", "#b23a5b", "#5f6b2b"] as const;

/** A number from an ID that is always the same for it and spread across IDs (FNV-1a). */
function seedOf(id: string) {
  let hash = 0x811c9dc5;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0;
  return hash;
}

/** A paper's title page and its ink, picked by its ID: one paper always wears the same, the next one likely another. */
export function coverOf(id: string): { kind: CoverKind; ink: string } {
  const seed = seedOf(id);
  return { kind: COVER_KINDS[seed % COVER_KINDS.length]!, ink: COVER_INKS[Math.floor(seed / COVER_KINDS.length) % COVER_INKS.length]! };
}

/** MOCK (mock/publish-reports): an Openscholar Report's title page, the same on its page and while it's being published. */
export const REPORT_COVER = { kind: "report", ink: COVER_INKS[0] } as const;

/**
 * Where communities keep the pictures of their PDFs' first pages, as new-el's own next.config.mjs allows them: Openscholar's
 * server resizes a cover from there to the size the page shows it at (next.config.ts).
 */
const COMMUNITY_FILES = ["tlxvwvgyaanqlmuyoguz", "ocivvlhqiwtxvnycqnia"].map((project) => `https://${project}.supabase.co/storage/v1/object/public/`);

/** The `images.remotePatterns` next.config.ts gives: a pattern made from a URL allows no query. */
export const COMMUNITY_FILE_PATTERNS = COMMUNITY_FILES.map((files) => new URL(`${files}**`));

/** Whether a cover is one Openscholar's server resizes: next.config.ts allows these addresses with no query. */
export const resizable = (src: string) => !src.includes("?") && COMMUNITY_FILES.some((files) => src.startsWith(files));
