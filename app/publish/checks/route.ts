import { auth } from "@clerk/nextjs/server";
import { checksFor, finishChecks, runCheck } from "@/lib/publish-mock/checks";
import { isMetadata, type CheckResult } from "@/lib/publish-mock/types";

// MOCK (mock/publish-reports): runs the report's checks side by side and sends each answer as a line of JSON the moment
// it comes, then the report as saved. The checks take from under a second (the byline) to about ten (Already published).
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to publish." }, { status: 401 });
  const { id, metadata } = (await request.json().catch(() => ({}))) as { id?: unknown; metadata?: unknown };
  if (typeof id !== "string" || !isMetadata(metadata)) return Response.json({ error: "The report's details are missing." }, { status: 400 });
  let prepared;
  try {
    prepared = await checksFor(id, userId, metadata);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The checks couldn't start." }, { status: 409 });
  }
  const { settings, draft, text, checks, version } = prepared;
  const run = draft.run!;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: object) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      const results: CheckResult[] = await Promise.all(
        checks.map(async (check) => {
          const result = await runCheck(check, settings, draft, text, metadata).catch((error: unknown): CheckResult => {
            console.error("[publish mock] check failed", { check: check.id, error: String(error) });
            // A check that can't answer holds the report for a person rather than pass it, and says why.
            return { checkId: check.id, name: check.name, model: check.model.name, pass: false, blocking: false, errored: true, detail: `This check couldn't finish: ${error instanceof Error ? error.message : "it failed"}. A reviewer looks instead.` };
          });
          send({ type: "result", result });
          return result;
        }),
      );
      try {
        send({ type: "done", draft: await finishChecks(id, run, metadata, results, version, new URL(request.url).origin) });
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : "The checks couldn't be saved." });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}

