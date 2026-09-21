import { mkdir, readFile, writeFile } from "node:fs/promises";
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
