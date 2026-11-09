import "server-only";
import { citationFile } from "@/lib/citations/files";
import type { CitationFile } from "@/lib/citations/formats";
import { paperToCitationData } from "@/lib/citations/paper-data";
import { readPaperPage } from "@/lib/papers/paper-page-data";

/** A paper's citation as a file to download: the same record its page shows, in the format a reference manager imports. */
export async function citeFileResponse(params: Promise<{ id: string }>, kind: CitationFile) {
  const read = await readPaperPage((await params).id);
  const data = read && paperToCitationData(read.paper);
  if (!data) return new Response("Not found", { status: 404 });
  // The record as the page shows it: OpenAlex's full author names where our index has initials, and the merged details.
  const { detail } = read;
  if (detail.authors.length) data.author = detail.authors.map((author) => ({ literal: author.name }));
  if (detail.journal) data["container-title"] = detail.journal.name;
  if (detail.ids.issn) data.ISSN = detail.ids.issn;
  if (detail.language) data.language = detail.language;
  if (detail.publisher) data.publisher = detail.publisher;
  const file = citationFile(data, kind);
  return new Response(file.text, {
    headers: {
      "Content-Type": `${file.type}; charset=utf-8`,
      // An ASCII name for every browser, and the real one, UTF-8 encoded, for those that read it (RFC 6266).
      "Content-Disposition": `attachment; filename="${file.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      // A record barely changes: browsers and Cloudflare keep it a day.
      "Cache-Control": "public, max-age=86400",
    },
  });
}
