import { readState } from "@/lib/publish-mock/store";
import { checksFor, finishChecks, runCheck } from "@/lib/publish-mock/checks";
import type { CheckResult, Metadata } from "@/lib/publish-mock/types";

// MOCK (mock/publish-reports): runs the report's checks side by side and sends each answer as a line of JSON the moment
// it comes, then the report as saved. The checks take from under a second (the byline) to about ten (Already published).
export async function POST(request: Request) {
  const { metadata } = (await request.json()) as { metadata: Metadata };
  const { draftId } = await readState();
  if (!draftId) return Response.json({ error: "No report is being published." }, { status: 409 });
  const { settings, draft, text, checks } = await checksFor(draftId);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: object) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      const results: CheckResult[] = await Promise.all(
        checks.map(async (check) => {
          const result = await runCheck(check, settings, draft, text, metadata).catch((error: unknown): CheckResult => {
            console.error("[publish mock] check failed", { check: check.id, error: String(error) });
            // A check that can't answer holds the report for a person rather than pass it.
            return { checkId: check.id, name: check.name, engine: check.engine, pass: false, score: 0, threshold: check.threshold, direction: check.direction, blocking: false, passFail: true, detail: "This check couldn't run. A reviewer looks instead." };
          });
          send({ type: "result", result });
          return result;
        }),
      );
      send({ type: "done", draft: await finishChecks(draftId, metadata, results) });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
