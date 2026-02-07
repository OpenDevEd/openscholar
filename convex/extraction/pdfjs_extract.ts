type PdfJsModule = {
  getDocument: (options: Record<string, unknown>) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getTextContent: (options: Record<string, unknown>) => Promise<{
          items: Array<{ str?: string; hasEOL?: boolean }>;
        }>;
      }>;
      destroy?: () => Promise<void> | void;
    }>;
  };
};

type PdfJsTextItem = {
  str: string;
  hasEOL?: boolean;
};

export type PdfPageText = {
  pageNumber: number;
  text: string;
  items: PdfJsTextItem[];
};

export async function extractPdfJsTextPages(
  pdfBuffer: ArrayBuffer
): Promise<{ pages: PdfPageText[]; totalPages: number }> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfJsModule;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const pages: PdfPageText[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent({
        disableNormalization: false,
        includeMarkedContent: false,
      });

      const pageTextItems: PdfJsTextItem[] = [];
      let pageText = "";

      for (const item of textContent.items) {
        const textItem = item as { str?: string; hasEOL?: boolean };
        if (typeof textItem.str !== "string") continue;
        pageTextItems.push({
          str: textItem.str,
          hasEOL: textItem.hasEOL,
        });
        pageText += textItem.str;
      }

      pages.push({
        pageNumber,
        text: pageText,
        items: pageTextItems,
      });
    }
  } finally {
    await pdf.destroy?.();
  }

  return { pages, totalPages };
}
