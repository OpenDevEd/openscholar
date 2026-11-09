import { COMPARISONS } from "../data/site.mjs";
// Every page of the site, read from the pages folder at build time, so a new page is listed without anyone adding it; pages made from data are listed from it.
const pages = [...Object.keys(import.meta.glob("./**/index.astro")).filter((file) => !file.includes("[")).map((file) => file.slice(1).replace(/index\.astro$/, "")), ...COMPARISONS.map((c) => c.href)];

export function GET() {
  const urls = pages.map((path) => `  <url><loc>https://openscholar.ai${path}</loc></url>`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}
