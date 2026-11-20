import "server-only";

/** What the file's own address answers that a reader's browser needs passed on: the file, and the part of it asked for. */
const PASSED = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

/**
 * A report's file passed through from the file store, not redirected to: the store's address names it by an
 * identifier, works for anyone it is given to, and was what a download was called. Here it carries `name`. A request
 * for part of it (a PDF viewer reading a long report page by page) is asked of the file the same way. Never kept:
 * who may have the file is asked every time.
 */
export async function passFile(request: Request, url: string, { key, name }: { key: string; name: string }) {
  const range = request.headers.get("range");
  const file = await fetch(url, { headers: range ? { Range: range } : {}, cache: "no-store" }).catch((error: unknown) => {
    console.error(JSON.stringify({ event: "report-file-unreachable", key, error: String(error).slice(0, 300) }));
    return null;
  });
  // The file was found to be theirs, so its not answering is the file store's trouble, not a missing page: said as
  // such, and logged with what the store answered, so an outage isn't read as a withdrawn report.
  if (!file?.ok || !file.body) {
    if (file) console.error(JSON.stringify({ event: "report-file-refused", key, status: file.status }));
    return new Response("The file can't be read right now", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const header of PASSED) {
    const value = file.headers.get(header);
    if (value) headers.set(header, value);
  }
  // Shown in the browser; saved, it is named by the report's key.
  headers.set("Content-Disposition", `inline; filename="${name}"`);
  return new Response(file.body, { status: file.status, headers });
}

/** Not found, and not kept: Cloudflare caches a 404 on a file's address, which would outlast a change by minutes. */
export const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
