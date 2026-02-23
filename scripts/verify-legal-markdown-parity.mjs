#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const DEFAULT_LOCALE = "en-US";
const LOCALES = ["en-US", "en-GB", "fr", "hi", "ja", "zh"];

const DOCS = [
  { key: "privacy", folder: "privacy-policy" },
  { key: "cookie", folder: "cookie-policy" },
];

function extractHeadingLevels(markdown) {
  return [...markdown.matchAll(/^(#{1,6})\s+/gm)].map((match) => match[1].length);
}

function extractUrls(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim())
    .sort();
}

function countTableColumns(row) {
  const normalized = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return normalized.split("|").length;
}

function extractTableShapes(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tables = [];
  let currentRows = [];

  for (const line of lines) {
    if (line.includes("|")) {
      currentRows.push(line);
      continue;
    }

    if (currentRows.length > 0) {
      const header = currentRows[0];
      const separator = currentRows[1] ?? "";
      const dataRows = currentRows.slice(2);
      const columnCount = countTableColumns(header);
      if (/^[:|\-\s]+$/.test(separator.replace(/\|/g, ""))) {
        tables.push({ columnCount, rowCount: dataRows.length });
      }
      currentRows = [];
    }
  }

  if (currentRows.length > 0) {
    const header = currentRows[0];
    const separator = currentRows[1] ?? "";
    const dataRows = currentRows.slice(2);
    const columnCount = countTableColumns(header);
    if (/^[:|\-\s]+$/.test(separator.replace(/\|/g, ""))) {
      tables.push({ columnCount, rowCount: dataRows.length });
    }
  }

  return tables;
}

function normalizeArray(values) {
  return JSON.stringify(values);
}

async function readDoc(folder, locale) {
  const filePath = path.join(CONTENT_ROOT, folder, `${locale}.md`);
  const content = await fs.readFile(filePath, "utf-8");
  return { filePath, content };
}

async function main() {
  const failures = [];

  for (const doc of DOCS) {
    const baseline = await readDoc(doc.folder, DEFAULT_LOCALE);
    const baselineHeadings = extractHeadingLevels(baseline.content);
    const baselineUrls = extractUrls(baseline.content);
    const baselineTables = extractTableShapes(baseline.content);

    for (const locale of LOCALES) {
      const current = await readDoc(doc.folder, locale);
      const headings = extractHeadingLevels(current.content);
      const urls = extractUrls(current.content);
      const tables = extractTableShapes(current.content);

      if (normalizeArray(headings) !== normalizeArray(baselineHeadings)) {
        failures.push(
          `${current.filePath}: heading levels do not match baseline ${baseline.filePath}`
        );
      }

      if (normalizeArray(urls) !== normalizeArray(baselineUrls)) {
        failures.push(
          `${current.filePath}: link URL set does not match baseline ${baseline.filePath}`
        );
      }

      if (normalizeArray(tables) !== normalizeArray(baselineTables)) {
        failures.push(
          `${current.filePath}: table shape does not match baseline ${baseline.filePath}`
        );
      }

      if (!current.content.includes("contact@opendeved.net")) {
        failures.push(
          `${current.filePath}: required contact marker contact@opendeved.net is missing`
        );
      }

      if (!current.content.includes("2026")) {
        failures.push(`${current.filePath}: required year marker 2026 is missing`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("Legal markdown parity check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Legal markdown parity check passed for all locales.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
