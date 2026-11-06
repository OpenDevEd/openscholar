import { readFileSync } from "node:fs";
import { join } from "node:path";

// The planet's script lives with the marketing site, whose build sees only its own folder, and is served here for the app's
// first screen (app/results/question-stage.tsx). Read once at build time.
export const dynamic = "force-static";

const source = readFileSync(join(process.cwd(), "marketing/src/planet/earth.js"), "utf8");

export function GET() {
  return new Response(source, { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
}
