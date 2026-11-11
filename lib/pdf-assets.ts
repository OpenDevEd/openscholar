/**
 * Where pdf.js finds what a PDF names but doesn't embed: the character maps for Chinese, Japanese and Korean text, and
 * the standard fonts. Without them that text draws as nothing. pdf.js's own copies, of the version loaded, as react-pdf
 * documents.
 */
export const pdfAssets = (version: string) => ({
  cMapUrl: `https://unpkg.com/pdfjs-dist@${version}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${version}/standard_fonts/`,
});
