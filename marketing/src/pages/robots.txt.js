import { TRAINING_CRAWLERS } from "../../../lib/seo/training-crawlers";

// Training crawlers read the home page only (`/$` is the longer match, so it wins over `/` there); everyone else reads everything.
export function GET() {
  const text = [
    ...TRAINING_CRAWLERS.map((name) => `User-agent: ${name}`),
    "Allow: /$",
    "Disallow: /",
    "",
    "User-agent: *",
    "Allow: /",
    "",
    "Sitemap: https://openscholar.ai/sitemap.xml",
    "",
  ].join("\n");
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
