/**
 * What can be attached to an assistant chat (#647), shared by the composer and the server.
 * Images go to the model with the message; PDFs and text files (plain text, Markdown, CSV) are
 * read a range at a time, pages or lines, when the person allows it (#648). Uploads an hour come from the person's plan
 * (lib/billing/plans.ts `uploads_per_hour`).
 */
import { MAX_PDF_BYTES, MAX_PDF_MB } from "../files/limits";

export { MAX_PDF_BYTES, MAX_PDF_MB };
/** The most pages one read of a PDF takes. */
export const PDF_PAGES_PER_READ = 20;
/**
 * Input tokens a PDF page comes to when a model reads it as it is, text and picture: Anthropic
 * counts 1,500 to 3,000 a page (platform.claude.com, PDF support). The upper end, for the most
 * a read can cost.
 */
export const PDF_PAGE_TOKENS = 3_000;

/** Files one message can carry. */
export const MAX_FILES_PER_MESSAGE = 10;
/** Files a person can have attached and not yet sent, across their chats. */
export const MAX_PENDING_FILES = 20;
/** The largest image a person can pick, before the composer shrinks it. */
export const MAX_IMAGE_MB = 20;
export const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;
/** The longest a file's name is kept. */
export const MAX_FILE_NAME = 200;
/**
 * The size the composer shrinks an image to: Claude's own ceiling, past which the model
 * scales it down anyway and only waits longer (platform.claude.com, Vision).
 */
export const IMAGE_EDGE = 1568;
export const IMAGE_PIXELS = 1_150_000;
/** A file no reply has read for this long is deleted, and its chat says so. */
export const FILE_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** A file attached and never sent is deleted after this long. */
export const PENDING_FILE_MS = 24 * 60 * 60 * 1000;

/** Whether a model takes images, from its OpenRouter input types (models.inputModalities). */
export const readsImages = (inputs: readonly string[] | undefined) => inputs?.includes("image") ?? false;
/** Whether a model reads PDFs as they are: OpenRouter lists "file" among its input types. */
export const readsPdfs = (inputs: readonly string[] | undefined) => inputs?.includes("file") ?? false;
export const isPdf = (mediaType: string) => mediaType === "application/pdf";
/**
 * What the browser adds to the end of a PDF it uploads, after its last line: a PDF comment
 * naming the file's row. Bytes that end with it were uploaded for that row, so they're the
 * only ones it binds or deletes (convex/assistant/pdf.ts).
 */
export const pdfTag = (fileId: string) => `\n%openscholar-file ${fileId}\n`;
/** The longest a tag is, past the PDF it ends. */
export const PDF_TAG_BYTES = 64;
export const isText = (mediaType: string) => mediaType.startsWith("text/");

/** The most a text file can be: what one upload request takes (convex/assistant/files.ts `upload`). */
export const MAX_TEXT_MB = 20;
export const MAX_TEXT_BYTES = MAX_TEXT_MB * 1024 * 1024;
/** The most one read of a text file returns: whole lines up to this many characters, under what a tool's result carries to the model. */
export const TEXT_CHARS_PER_READ = 15_000;
/** The lines a read takes when it names none. */
export const TEXT_LINES_PER_READ = 500;

/** A text file's type, by its name or what the browser says it is: plain text, Markdown or CSV. Null for anything else. */
export function textTypeOf(name: string, type: string) {
  const extension = name.toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (type === "text/csv" || extension === "csv" || extension === "tsv") return "text/csv";
  if (type === "text/markdown" || extension === "md" || extension === "markdown") return "text/markdown";
  if (type === "text/plain" || extension === "txt") return "text/plain";
  return null;
}

/** "120-300" as the lines it names, within a file of `of` lines; without one, the first lines. Null when it names none. */
export function linesIn(range: string | undefined, of: number): { first: number; last: number } | null {
  const match = (range ?? "").trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if (range !== undefined && !match) return null;
  const first = match ? Number(match[1]) : 1;
  const last = match ? Number(match[2] ?? match[1]) : Math.min(of, TEXT_LINES_PER_READ);
  if (first < 1 || last < first || first > of) return null;
  return { first, last: Math.min(last, of) };
}

/** "3-7" as the pages it names, within a PDF of `of` pages; a single page is "5". Null when it names none. */
export function pagesIn(range: string | undefined, of: number): { first: number; last: number } | null {
  const match = (range ?? "").trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
  const first = match ? Number(match[1]) : 1;
  const last = match ? Number(match[2] ?? match[1]) : Math.min(of, PDF_PAGES_PER_READ);
  if (range !== undefined && !match) return null;
  if (first < 1 || last < first || first > of) return null;
  return { first, last: Math.min(last, of, first + PDF_PAGES_PER_READ - 1) };
}
