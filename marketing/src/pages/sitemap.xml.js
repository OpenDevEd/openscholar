// Every page of the site, read from the pages folder at build time, so a new page is listed without anyone adding it.
const pages = Object.keys(import.meta.glob("./**/index.astro"));

export function GET() {
  const urls = pages.map((file) => `  <url><loc>https://openscholar.ai${file.slice(1).replace(/index\.astro$/, "")}</loc></url>`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}
