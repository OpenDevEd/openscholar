import { readFile } from "node:fs/promises";
import { auth } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/publish-mock/admin";
import { coverPath, fileAccess } from "@/lib/publish-mock/store";

// MOCK (mock/publish-reports): the picture of a report's first page, from the mock's local store. Until the report is
// live only its author sees it. Its address carries when it was made, so a live report's cover can be kept for good.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await fileAccess(id, (await auth()).userId, isAdmin);
  const file = access ? await readFile(coverPath(id)).catch(() => null) : null;
  if (!access || !file) return new Response(null, { status: 404 });
  return new Response(file, { headers: { "Content-Type": "image/jpeg", "Cache-Control": access.public ? "public, max-age=31536000, immutable" : "private, no-store" } });
}
