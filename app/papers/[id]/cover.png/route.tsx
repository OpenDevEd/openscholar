import { ImageResponse } from "next/og";
import { readPaperPage } from "@/lib/papers/paper-page-data";

/** The shapes Google asks an article's images in (16:9, 4:3 and 1:1), and the one link previews use. */
const SIZES = { "16x9": [1200, 675], "4x3": [1200, 900], "1x1": [1200, 1200], share: [1200, 630] } as const;

/**
 * A paper's picture: its title, journal and year on the site's night blue, for link previews and for search engines,
 * which want an image for every article. Drawn from the same record the page shows.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const read = await readPaperPage((await params).id);
  if (!read) return new Response("Not found", { status: 404 });
  const ratio = new URL(request.url).searchParams.get("ratio") as keyof typeof SIZES | null;
  const [width, height] = SIZES[ratio && Object.hasOwn(SIZES, ratio) ? ratio : "share"];
  const { paper, detail } = read;
  const title = paper.title ?? paper.display_name ?? "";
  const meta = [detail.journal?.name, paper.publication_year].filter(Boolean).join(", ");
  return new ImageResponse(
    (
      <div style={{ width, height, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "linear-gradient(160deg, #0b1530, #091026 60%, #2a1406)", color: "#fff", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 30, color: "#ff9d36", letterSpacing: 1 }}>Openscholar</div>
        <div style={{ display: "flex", fontSize: title.length > 120 ? 52 : 64, lineHeight: 1.12, fontWeight: 600, maxHeight: height - 300, overflow: "hidden" }}>{title}</div>
        <div style={{ display: "flex", fontSize: 30, color: "rgba(255,255,255,0.72)" }}>{meta}</div>
      </div>
    ),
    { width, height, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
