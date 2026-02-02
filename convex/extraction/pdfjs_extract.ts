import { getDocumentProxy, getResolvedPDFJS } from "unpdf";

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
  await getResolvedPDFJS();
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const totalPages = pdf.numPages;
  const pages: PdfPageText[] = [];

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

  return { pages, totalPages };
}
