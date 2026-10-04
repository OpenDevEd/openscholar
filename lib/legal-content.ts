import * as fs from "node:fs/promises";
import path from "node:path";

export const LEGAL_CONTENT_ROOT = path.join(process.cwd(), "content");
export const LEGAL_DEFAULT_LOCALE = "en-US";

const DOC_DIRECTORY: Record<LegalDocumentType, string> = {
  privacy: "privacy-policy",
  cookie: "cookie-policy",
  credits: "credits",
};

const SAFE_LOCALE_PATTERN = /^[A-Za-z0-9-]+$/;

export type LegalDocumentType = "privacy" | "cookie" | "credits";

export interface GetLegalMarkdownParams {
  docType: LegalDocumentType;
  locale: string;
  contentRoot?: string;
}

export function getLegalMarkdownPath(
  docType: LegalDocumentType,
  locale: string,
  contentRoot = LEGAL_CONTENT_ROOT
): string {
  if (!SAFE_LOCALE_PATTERN.test(locale)) {
    throw new Error(`Invalid locale for legal content: ${locale}`);
  }

  return path.join(contentRoot, DOC_DIRECTORY[docType], `${locale}.md`);
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export async function getLegalMarkdown({
  docType,
  locale,
  contentRoot = LEGAL_CONTENT_ROOT,
}: GetLegalMarkdownParams): Promise<string> {
  const requestedPath = getLegalMarkdownPath(docType, locale, contentRoot);

  try {
    return await fs.readFile(requestedPath, "utf-8");
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }

  if (locale === LEGAL_DEFAULT_LOCALE) {
    throw new Error(`Missing legal markdown source: ${requestedPath}`);
  }

  const fallbackPath = getLegalMarkdownPath(
    docType,
    LEGAL_DEFAULT_LOCALE,
    contentRoot
  );

  try {
    return await fs.readFile(fallbackPath, "utf-8");
  } catch (error) {
    if (isEnoent(error)) {
      throw new Error(
        `Missing legal markdown source: ${fallbackPath} (requested locale: ${locale})`
      );
    }

    throw error;
  }
}
