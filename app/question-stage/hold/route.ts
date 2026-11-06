/**
 * An empty stylesheet that takes its time. Coming from the hero, the page's first script asks the browser to wait for it
 * before painting, and the planet's script removes it as soon as its first frame is drawn: so the page the visitor came
 * from stays on screen until the planet is there (lib/search/question-stage-script.ts). The delay is the most it can wait.
 */
const HOLD_MS = 1500;

export async function GET() {
  await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
  return new Response("", { headers: { "Content-Type": "text/css", "Cache-Control": "no-store" } });
}
