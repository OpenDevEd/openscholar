import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { CSL } from "citeproc-plus";
import { CITATION_FORMATS } from "../lib/citations/formats.ts";

// Node 22.18+ runs this TypeScript catalog through native type stripping.
const catalog = new CSL();
const styles = {};
for (const { style } of CITATION_FORMATS) {
  if (style) styles[style] = await catalog.getStyle(style);
}
const locales = {};
for (const locale of ["en-US", "en-GB", "de-DE", "fr-FR", "hi-IN", "pt-PT", "zh-CN", "ja-JP", "ar"]) {
  locales[locale] = await catalog.getLocale(styles.apa, locale, locale);
}
const packageRoot = new URL("../node_modules/citeproc-plus/", import.meta.url);
const provenance = {
  package: "citeproc-plus@2.0.4",
  styles: (await readFile(new URL("styles_version.txt", packageRoot), "utf8")).trim(),
  locales: (await readFile(new URL("locales_version.txt", packageRoot), "utf8")).trim(),
};
const directory = new URL("../lib/citations/assets/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("csl.json", directory), JSON.stringify({ provenance, styles, locales }) + "\n");
console.log(`Bundled ${Object.keys(styles).length} citation styles and ${Object.keys(locales).length} locales.`);

// Keep additional styles out of the initial JavaScript bundle. Small compressed
// groups share a content-addressed URL and one browser cache entry.
const output = new URL("../public/citation-styles/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const common = new Set(CITATION_FORMATS.map(({ style }) => style).filter(Boolean));
const groups = Array.from({ length: 32 }, () => []);
for (const [id, label] of Object.entries(await catalog.getStyles()).sort(([a], [b]) => a.localeCompare(b, "en"))) {
  if (!common.has(id)) groups[createHash("sha256").update(id).digest()[0] % groups.length].push({ id, label });
}
const index = [];
for (const group of groups) {
  const payload = { styles: {}, locales: {} };
  for (const entry of group) {
    const style = await catalog.getStyle(entry.id);
    payload.styles[entry.id] = style;
    const locale = style.attrs["default-locale"];
    if (locale && !locales[locale]) payload.locales[locale] = await catalog.getLocale(style, locale, locale);
  }
  const bytes = gzipSync(JSON.stringify(payload));
  const filename = `${createHash("sha256").update(bytes).digest("hex").slice(0, 20)}.json.gz`;
  await writeFile(new URL(filename, output), bytes);
  for (const entry of group) index.push({ ...entry, asset: `/citation-styles/${filename}` });
}
index.sort((a, b) => a.label.localeCompare(b.label, "en"));
await writeFile(new URL("catalog.json", directory), JSON.stringify(index) + "\n");
console.log(`Prepared ${index.length} additional styles in ${groups.length} cached files.`);
