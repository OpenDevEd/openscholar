import "server-only";
import { citationFile } from "@/lib/citations/formatter";
import type { CitationFile } from "@/lib/citations/formats";
import { paperToCitationData } from "@/lib/citations/paper-data";
import { readPaperPage } from "@/lib/papers/paper-page-data";

/** A paper's citation as a file to download: the same record its page shows, in the format a reference manager imports. */
export async function citeFileResponse(params: Promise<{ id: string }>, kind: CitationFile) {
  const read = await readPaperPage((await params).id);
  const data = read && paperToCitationData(read.paper);
  if (!data) return new Response("Not found", { status: 404 });
  // The authors as the page names them: OpenAlex's full names where our index has initials.
  if (read.detail.authors.length) data.author = read.detail.authors.map((author) => ({ literal: author.name }));
  const file = citationFile(data, kind);
  return new Response(file.text, {
    headers: {
      "Content-Type": `${file.type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${file.name}"`,
      // A record barely changes: browsers and Cloudflare keep it a day.
      "Cache-Control": "public, max-age=86400",
    },
  });
}
