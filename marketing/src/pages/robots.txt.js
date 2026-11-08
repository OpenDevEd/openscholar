import { TRAINING_CRAWLERS } from "../../../lib/seo/training-crawlers";

// Training crawlers read the home page only (`/$` is the longer match, so it wins over `/` there); everyone else reads all but the hero trials.
export function GET() {
  const text = [
    ...TRAINING_CRAWLERS.map((name) => `User-agent: ${name}`),
    "Allow: /$",
    "Disallow: /",
    "",
    "User-agent: *",
    "Allow: /",
    ...["a2", "a3", "a4", "a5", "a6"].map((page) => `Disallow: /${page}/`),
    "",
    "Sitemap: https://openscholar.ai/sitemap.xml",
    "",
  ].join("\n");
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
