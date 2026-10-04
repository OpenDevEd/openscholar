import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = new URL("../public/assistant-branding/", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");
const data = async (name, type) => `data:${type};base64,${(await readFile(new URL(name, root))).toString("base64")}`;
let html = await read("index.html");
let css = await read("studio.css");
const awaitedMotion = await read("orbit.css");
for (const name of ["Regular", "Medium", "Bold"]) {
  const file = `Ubuntu-${name}.woff2`;
  css = css.replace(`url(${file})`, `url(${await data(file, "font/woff2")})`);
}
const logo = await data("../icon.svg", "image/svg+xml");
css = css.replace("url(../icon-black.svg)", `url(${await data("../icon-black.svg", "image/svg+xml")})`);
let js = await read("studio.js");
js = js.replace('import { orbitSeconds, orbitShape } from "./orbit.js";', (await read("orbit.js")).replaceAll("export const", "const"));
js = js.replace('src="../icon.svg"', `src="${logo}"`);
html = html.replace('<link rel="stylesheet" href="studio.css">', () => `<style>${css}</style>`);
html = html.replace('<link id="assistant-motion" rel="stylesheet" href="orbit.css">', () => `<style id="assistant-motion">${awaitedMotion}</style>`);
html = html.replace('<script type="module" src="studio.js"></script>', () => `<script>${js}</script>`);
html = html.replace('href="../icon.svg"', `href="${logo}"`);
html = html.replace('href="Ubuntu-LICENSE.txt"', `download="Ubuntu-LICENSE.txt" href="${await data("Ubuntu-LICENSE.txt", "text/plain")}"`);
const destination = resolve(process.argv[2] || fileURLToPath(new URL("preview.html", root)));
await writeFile(destination, html);
console.log(destination);
