// MOCK (mock/publish-reports): a picture of a report's first page, made when its PDF is uploaded. It is drawn the way
// a community draws its covers (new-el's src/lib/admin/pdf-read.mjs): pdf.js renders page 1 onto its own canvas.
// The real build keeps the picture in file storage beside the PDF and resizes it for each place it shows.
import path from "node:path";

/** Wide enough for the cover at twice its largest size on a page (200 px). new-el keeps 1600 and resizes on the way out. */
const COVER_WIDTH = 800;

// pdf.js reads character maps, the standard fonts and its image decoders from these folders; without them a cover
// loses text set in those fonts and leaves scanned images out.
const PDFJS = path.join(process.cwd(), "node_modules", "pdfjs-dist");

type Canvas = { toBuffer: (type: "image/jpeg", quality: number) => Buffer };
type Viewport = { width: number; height: number };
type PdfJs = {
  getDocument: (options: Record<string, unknown>) => {
    promise: Promise<{
      canvasFactory: { create: (width: number, height: number) => { canvas: Canvas; context: unknown } };
      getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => Viewport; render: (o: { canvasContext: unknown; viewport: Viewport }) => { promise: Promise<void> }; cleanup: () => void }>;
    }>;
    destroy: () => Promise<void>;
  };
};

/** The PDF's first page as a JPEG. Takes a copy of the bytes: pdf.js keeps the buffer it is given. */
export async function renderCover(pdf: ArrayBuffer): Promise<Buffer> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJs;
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: true,
    isEvalSupported: false,
    cMapUrl: `${path.join(PDFJS, "cmaps")}/`,
    standardFontDataUrl: `${path.join(PDFJS, "standard_fonts")}/`,
    wasmUrl: `${path.join(PDFJS, "wasm")}/`,
    iccUrl: `${path.join(PDFJS, "iccs")}/`,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    const page = await document.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: COVER_WIDTH / natural.width });
    const { canvas, context } = document.canvasFactory.create(COVER_WIDTH, Math.max(1, Math.round(viewport.height)));
    await page.render({ canvasContext: context, viewport }).promise;
    page.cleanup();
    return canvas.toBuffer("image/jpeg", 92);
  } finally {
    await task.destroy();
  }
}
