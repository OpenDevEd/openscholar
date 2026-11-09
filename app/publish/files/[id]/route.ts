import { readFile } from "node:fs/promises";
import { pdfPath } from "@/lib/publish-mock/store";

// MOCK (mock/publish-reports): a report's PDF, from the mock's local store.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^R\d+$/.test(id)) return new Response(null, { status: 404 });
  const file = await readFile(pdfPath(id)).catch(() => null);
  return file ? new Response(file, { headers: { "Content-Type": "application/pdf" } }) : new Response(null, { status: 404 });
}
