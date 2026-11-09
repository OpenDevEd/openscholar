import { readFile } from "node:fs/promises";
import { auth } from "@clerk/nextjs/server";
import { fileAccess, pdfPath } from "@/lib/publish-mock/store";

// MOCK (mock/publish-reports): a report's PDF, from the mock's local store. Until the report is live only its author reads it.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await fileAccess(id, (await auth()).userId);
  const file = access ? await readFile(pdfPath(id)).catch(() => null) : null;
  if (!access || !file) return new Response(null, { status: 404 });
  return new Response(file, { headers: { "Content-Type": "application/pdf", "Cache-Control": access.public ? "public, max-age=300" : "private, no-store" } });
}
