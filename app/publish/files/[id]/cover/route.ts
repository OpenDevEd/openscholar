import { readFile } from "node:fs/promises";
import { coverPath } from "@/lib/publish-mock/store";

// MOCK (mock/publish-reports): the picture of a report's first page, from the mock's local store. Its address
// carries when it was made, so a new PDF's cover is a new address and this one can be kept for good.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^R\d+$/.test(id)) return new Response(null, { status: 404 });
  const file = await readFile(coverPath(id)).catch(() => null);
  return file ? new Response(file, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } }) : new Response(null, { status: 404 });
}
