// Deletes page images no built page uses. Run after a build: node art/prune.mjs
import { readFileSync, readdirSync, rmSync } from "node:fs";
const dist = new URL("../dist/", import.meta.url).pathname, img = new URL("../public/img/", import.meta.url).pathname;
const html = readdirSync(dist, { recursive: true }).filter((f) => f.endsWith(".html")).map((f) => readFileSync(dist + f, "utf8")).join("");
let gone = 0;
for (const f of readdirSync(img, { recursive: true }).filter((x) => x.endsWith(".avif"))) if (!html.includes(`/img/${f}`)) { rmSync(img + f); gone++; }
console.log("removed", gone);
