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

/** An Openscholar Report's title page, the same on its page and while it's being published. */
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

/** A width over height a cover can have: a page or slide, not a sliver either way. */
export const isCoverShape = (shape: number) => Number.isFinite(shape) && shape >= 0.2 && shape <= 5;

/** The shapes a page comes in, as its width over its height: A4 is 0.71 and US Letter 0.77. */
const PAGE_SHAPES = { narrowest: 0.66, widest: 0.8 } as const;

/**
 * How the picture of a first page sits in a cover's frame, which is 3 wide by 4 tall, from the picture's width over its
 * height. One shaped like a page fills the frame and loses a sliver at most. A wider one, such as a slide, spans the
 * frame's width, and a narrower one its height: each is shown whole, at its own shape. Until the picture has loaded
 * its shape is unknown (null), and the frame is kept whole for it.
 */
export function coverFit(shape: number | null): "fill" | "wide" | "tall" {
  if (shape === null || !Number.isFinite(shape) || shape <= 0) return "fill";
  if (shape >= PAGE_SHAPES.narrowest && shape <= PAGE_SHAPES.widest) return "fill";
  return shape > 3 / 4 ? "wide" : "tall";
}
