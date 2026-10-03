#!/usr/bin/env node
// Writes public/citation-styles/credits.txt: who wrote each bundled citation style
// and locale. The styles and locales are CC BY-SA 3.0, and the generated JSON
// drops each file's own author block, so this file carries the credit. It
// reads the upstream repositories at the commits recorded in csl.json.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "lib/citations/assets");
const { provenance, styles: bundled } = JSON.parse(await readFile(path.join(assets, "csl.json"), "utf8"));
const catalog = JSON.parse(await readFile(path.join(assets, "catalog.json"), "utf8"));
const styleIds = [...new Set([...Object.keys(bundled), ...catalog.map(({ id }) => id)])].sort((a, b) => a.localeCompare(b, "en"));

const work = await mkdtemp(path.join(tmpdir(), "csl-credits-"));
async function checkout(repository, commit) {
  const response = await fetch(`https://codeload.github.com/citation-style-language/${repository}/tar.gz/${commit}`);
  if (!response.ok) throw new Error(`Could not download ${repository} at ${commit}: ${response.status}`);
  const archive = path.join(work, `${repository}.tar.gz`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  execFileSync("tar", ["-xzf", archive, "-C", work]);
  return path.join(work, `${repository}-${commit}`);
}

const decode = (text) => text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, " ").trim();
const names = (info, role) => [...info.matchAll(new RegExp(`<${role}>([\\s\\S]*?)</${role}>`, "g"))]
  .map(([, person]) => person.match(/<name>([\s\S]*?)<\/name>/)?.[1])
  .filter(Boolean)
  .map(decode);
const infoOf = (xml) => xml.match(/<info>([\s\S]*?)<\/info>/)?.[1] ?? "";

try {
  const [stylesRoot, localesRoot] = await Promise.all([
    checkout("styles", provenance.styles),
    checkout("locales", provenance.locales),
  ]);

  const lines = [
    "OpenScholar citation styles and locales: authors and licence",
    "",
    "Every style and locale below is licensed under the Creative Commons",
    "Attribution-ShareAlike 3.0 License: https://creativecommons.org/licenses/by-sa/3.0/",
    "",
    "OpenScholar converts each file from XML to JSON. When it lists references, it",
    "removes the citation number from styles that number their entries.",
    "",
    `Styles: https://github.com/citation-style-language/styles/tree/${provenance.styles}`,
    `Locales: https://github.com/citation-style-language/locales/tree/${provenance.locales}`,
    "",
    "STYLES",
    "",
  ];
  for (const id of styleIds) {
    // A style that is not in the upstream repository has no author record to credit, so this fails.
    const info = infoOf(await readFile(path.join(stylesRoot, `${id}.csl`), "utf8"));
    const title = decode(info.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? id);
    const authors = names(info, "author");
    const contributors = names(info, "contributor");
    lines.push(`${title} (${id}). Authors: ${authors.join(", ") || "not named in the file"}.${contributors.length ? ` Contributors: ${contributors.join(", ")}.` : ""}`);
  }

  lines.push("", "LOCALES", "");
  for (const file of (await readdir(localesRoot)).filter((name) => /^locales-.+\.xml$/.test(name)).sort()) {
    const translators = names(infoOf(await readFile(path.join(localesRoot, file), "utf8")), "translator");
    lines.push(`${file.slice("locales-".length, -".xml".length)}. Translators: ${translators.join(", ") || "not named in the file"}.`);
  }

  await writeFile(path.join(root, "public/citation-styles/credits.txt"), lines.join("\n") + "\n");
  console.log(`Credited the authors of ${styleIds.length} styles.`);
} finally {
  await rm(work, { recursive: true, force: true });
}
