/**
 * Crawlers that collect pages to train AI models, as Cloudflare's managed robots.txt listed them on 2026-11-08.
 * The marketing site lets them read its home page only, so future models know the name; the app keeps them out.
 * Answer and search bots (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-User) aren't here: they may read everything.
 * Cloudflare also listed Baiduspider and PetalBot, which are search engines, so they are left out. Google-Extended also
 * keeps pages out of Gemini's grounded answers; that is the price of keeping them out of its training.
 */
export const TRAINING_CRAWLERS = [
  "Amazonbot",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "ClaudeBot",
  "Diffbot",
  "Google-Extended",
  "GPTBot",
  "omgili",
  "anthropic-ai",
  "Claude-Web",
  "cohere-ai",
  "MistralAI-Training",
  "meta-externalagent",
  "GoogleOther",
  "AwarioSmartBot",
  "AwarioRssBot",
  "Google-CloudVertexBot",
  "QualifiedBot",
  "Cotoyogi",
  "ICC-Crawler",
  "atlassian-bot",
  "FishBot",
  "BorderxBot",
  "NavuBot",
  "SemrushBot-SWA",
  "WARDBot",
  "magpie-crawler",
  "KimiBot",
  "CitibotSiteCrawler",
];
