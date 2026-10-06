import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Builds one offline HTML file from public/assistant-branding/ai-mark.html, with every style, script, font and logo inlined.
const root = new URL("../public/assistant-branding/", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");
const data = async (name, type) => `data:${type};base64,${(await readFile(new URL(name, root))).toString("base64")}`;
let html = await read("ai-mark.html");
let css = await read("studio.css");
for (const name of ["Regular", "Medium", "Bold"]) {
  const file = `Ubuntu-${name}.woff2`;
  css = css.replace(`url(${file})`, `url(${await data(file, "font/woff2")})`);
}
const logo = await data("../icon.svg", "image/svg+xml");
css = css.replace("url(../icon-black.svg)", `url(${await data("../icon-black.svg", "image/svg+xml")})`);
// The Orbit studio imports orbit.js; inline both as one script with no imports.
let studio = await read("studio.js");
const orbit = (await read("orbit.js")).replaceAll("export const", "const");
studio = studio.replace('import { orbitSeconds, orbitShape } from "./orbit.js";', () => orbit);
const inline = async (tag, name) => {
  const content = await read(name);
  const open = tag.startsWith("<link") ? `<style${tag.includes('id="assistant-motion"') ? ' id="assistant-motion"' : ""}>` : "<script>";
  return html.replace(tag, () => `${open}${content}${tag.startsWith("<link") ? "</style>" : "</script>"}`);
};
html = html.replace('<link rel="stylesheet" href="studio.css">', () => `<style>${css}</style>`);
html = await inline('<link id="assistant-motion" rel="stylesheet" href="orbit.css">', "orbit.css");
html = await inline('<link rel="stylesheet" href="ai-mark.css">', "ai-mark.css");
html = await inline('<link rel="stylesheet" href="ai-studio.css">', "ai-studio.css");
// The AI mark studio imports the shared ai-mark.js module; inline both as one module script.
const mark = (await read("ai-mark.js")).replaceAll("export function", "function");
const aiStudio = (await read("ai-studio.js")).replace('import { aiMarkParts, play, stop } from "./ai-mark.js";', () => mark);
html = html.replace('<script type="module" src="ai-studio.js"></script>', () => `<script type="module">${aiStudio}</script>`);
// Still a module, so its names stay out of the page scripts' global scope.
html = html.replace('<script type="module" src="studio.js"></script>', () => `<script type="module">${studio}</script>`);
html = html.replaceAll('src="../icon.svg"', `src="${logo}"`).replace('href="../icon.svg"', `href="${logo}"`);
html = html.replace('href="Ubuntu-LICENSE.txt"', `download="Ubuntu-LICENSE.txt" href="${await data("Ubuntu-LICENSE.txt", "text/plain")}"`);
const destination = resolve(process.argv[2] || fileURLToPath(new URL("preview.html", root)));
await writeFile(destination, html);
console.log(destination);
