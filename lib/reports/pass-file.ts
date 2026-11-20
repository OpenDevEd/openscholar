import "server-only";

/** What the file's own address answers that a reader's browser needs passed on: the file, and the part of it asked for. */
const PASSED = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];
/** What the browser asks that the file's own address answers: a part of it, and only while it is the file that part was of. */
const ASKED = ["range", "if-range"];

/**
 * A report's file passed through from the file store, not redirected to: the store's address names it by an
 * identifier, works for anyone it is given to, and was what a download was called. Here it carries `name`. A request
 * for part of it (a PDF viewer reading a long report page by page) is asked of the file the same way. Never kept:
 * who may have the file is asked every time.
 */
export async function passFile(request: Request, url: string, { key, name, token }: { key: string; name: string; /** Who is asking, for an address that answers only them. */ token?: string }) {
  const headers = new Headers(token ? { Authorization: `Bearer ${token}` } : {});
  for (const header of ASKED) {
    const value = request.headers.get(header);
    if (value) headers.set(header, value);
  }
  const file = await fetch(url, { headers, cache: "no-store" }).catch((error: unknown) => {
    console.error(JSON.stringify({ event: "report-file-unreachable", key, error: String(error).slice(0, 300) }));
    return null;
  });
  // The file was found to be theirs, so its not answering is the file store's trouble, not a missing page: said as
  // such, and logged with what the store answered, so an outage isn't read as a withdrawn report.
  // Not theirs, or gone: not found, as for any address that names nothing.
  if (file?.status === 404) return notFound();
  // A part asked for that the file hasn't (416) is the browser's to hear, with the file's size beside it.
  if (!file || (!file.ok && file.status !== 416) || (file.ok && !file.body)) {
    if (file) console.error(JSON.stringify({ event: "report-file-refused", key, status: file.status }));
    return new Response("The file can't be read right now", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  const passed = new Headers({ "Cache-Control": "no-store" });
  for (const header of PASSED) {
    const value = file.headers.get(header);
    if (value) passed.set(header, value);
  }
  // Shown in the browser; saved, it is named by the report's key.
  passed.set("Content-Disposition", `inline; filename="${name}"`);
  return new Response(file.body, { status: file.status, headers: passed });
}

/** Not found, and not kept: Cloudflare caches a 404 on a file's address, which would outlast a change by minutes. */
export const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
