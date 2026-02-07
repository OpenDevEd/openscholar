"use node";

import { load } from "cheerio";

export type GrobidTextBlock = {
  section: string;
  text: string;
  page?: number;
};

export type GrobidParseResult = {
  title?: string;
  blocks: GrobidTextBlock[];
  teiXml: string;
};

const DEFAULT_GROBID_URL = process.env.GROBID_URL || "http://localhost:8070";
const DEFAULT_GROBID_TIMEOUT_MS = Number(
  process.env.GROBID_TIMEOUT_MS || "45000"
);
const DOCKER_GROBID_URL = "http://grobid:8070";
const LOCAL_GROBID_URL = "http://localhost:8070";
const HOST_GROBID_URL = "http://host.docker.internal:8070";

function normalizeSpace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sectionLabel(value?: string) {
  const normalized = normalizeSpace(value || "");
  return normalized ? normalized.toLowerCase() : "body";
}

function parsePageFromCoords(coords?: string) {
  if (!coords) return undefined;
  const first = coords.split(";")[0]?.trim();
  if (!first) return undefined;
  const page = Number(first.split(",")[0]);
  if (!Number.isFinite(page) || page < 1) return undefined;
  return page;
}

function appendSentenceOrParagraphBlocks(
  $: ReturnType<typeof load>,
  paragraph: any,
  section: string,
  blocks: GrobidTextBlock[]
) {
  const sentences = $(paragraph).find("s");
  if (sentences.length > 0) {
    sentences.each((_, sentence) => {
      const text = normalizeSpace($(sentence).text());
      if (!text) return;
      blocks.push({
        section,
        text,
        page: parsePageFromCoords($(sentence).attr("coords")),
      });
    });
    return;
  }

  const text = normalizeSpace($(paragraph).text());
  if (!text) return;
  blocks.push({
    section,
    text,
    page: parsePageFromCoords($(paragraph).attr("coords")),
  });
}

function collectBlocks(teiXml: string): GrobidTextBlock[] {
  const $ = load(teiXml, { xml: true });
  const blocks: GrobidTextBlock[] = [];

  $("abstract p").each((_, p) => {
    appendSentenceOrParagraphBlocks($, p, "abstract", blocks);
  });

  $("body div").each((_, div) => {
    const section = sectionLabel($(div).find("head").first().text());
    $(div)
      .find("p")
      .each((__, p) => {
        appendSentenceOrParagraphBlocks($, p, section, blocks);
      });
  });

  // Fallback: if structured sections are missing, extract paragraphs globally.
  if (blocks.length === 0) {
    $("p").each((_, p) => {
      appendSentenceOrParagraphBlocks($, p, "body", blocks);
    });
  }

  return blocks;
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/$/, "");
}

function resolveCandidateBaseUrls(explicitBaseUrl?: string) {
  const ordered: string[] = [];
  const push = (value?: string) => {
    if (!value) return;
    const normalized = normalizeBaseUrl(value);
    if (!normalized || ordered.includes(normalized)) return;
    ordered.push(normalized);
  };

  push(explicitBaseUrl);
  push(process.env.GROBID_URL);
  push(DOCKER_GROBID_URL);
  push(LOCAL_GROBID_URL);
  push(HOST_GROBID_URL);

  if (ordered.length === 0) {
    push(DEFAULT_GROBID_URL);
  }

  return ordered;
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function processFulltextDocumentWithGrobid(
  pdfBuffer: ArrayBuffer,
  options?: { baseUrl?: string; timeoutMs?: number }
): Promise<GrobidParseResult> {
  const timeoutMs = options?.timeoutMs || DEFAULT_GROBID_TIMEOUT_MS;
  const baseUrls = resolveCandidateBaseUrls(options?.baseUrl);
  const failures: string[] = [];

  for (const baseUrl of baseUrls) {
    const endpoint = `${baseUrl}/api/processFulltextDocument`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const form = new FormData();
    form.append(
      "input",
      new Blob([pdfBuffer], { type: "application/pdf" }),
      "paper.pdf"
    );
    form.append("consolidateHeader", "1");
    form.append("consolidateCitations", "0");
    form.append("segmentSentences", "1");
    form.append("teiCoordinates", "head");
    form.append("teiCoordinates", "p");
    form.append("teiCoordinates", "s");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${body.slice(0, 300)}`
        );
      }

      const teiXml = await response.text();
      if (!teiXml.includes("<TEI")) {
        throw new Error("Response did not contain TEI XML");
      }

      const $ = load(teiXml, { xml: true });
      const title = normalizeSpace($("titleStmt > title").first().text());
      const blocks = collectBlocks(teiXml);
      if (blocks.length === 0) {
        throw new Error("No text blocks parsed from TEI output");
      }

      return {
        title: title || undefined,
        blocks,
        teiXml,
      };
    } catch (error) {
      failures.push(`${baseUrl}: ${toErrorMessage(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `GROBID parsing failed across ${baseUrls.length} endpoint(s): ${failures.join(
      " | "
    )}`
  );
}
