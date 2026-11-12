// A picture of a report's first page, drawn by the browser that uploads its PDF and kept beside it. A community
// draws its covers the same way on its server (new-el's src/lib/admin/pdf-read.mjs): pdf.js renders page 1 on a canvas.

import { pdfAssets } from "@/lib/pdf-assets";

/** Wide enough for the cover at twice its largest size on a page (200 px). */
const COVER_WIDTH = 800;

/** The PDF's first page as a JPEG with its shape (width over height), or null when it can't be drawn: the report then keeps its title page. */
export async function drawCover(file: File): Promise<{ picture: Blob; shape: number } | null> {
  try {
    const { pdfjs } = await import("react-pdf");
    pdfjs.GlobalWorkerOptions.workerSrc ||= new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...pdfAssets(pdfjs.version) });
    try {
      const page = await (await task.promise).getPage(1);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: COVER_WIDTH / natural.width });
      const canvas = document.createElement("canvas");
      canvas.width = COVER_WIDTH;
      canvas.height = Math.max(1, Math.round(viewport.height));
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
      const picture = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      return picture ? { picture, shape: canvas.width / canvas.height } : null;
    } finally {
      await task.destroy();
    }
  } catch (error) {
    console.error("[publish] the cover couldn't be drawn", error);
    return null;
  }
}
