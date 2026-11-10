import { actor } from "@/lib/publish-mock/admin";
import { checksFor, finishChecks, finishCorrection, runCheck } from "@/lib/publish-mock/checks";
import { forAuthor, isMetadata, type CheckResult } from "@/lib/publish-mock/types";

// MOCK (mock/publish-reports): runs the report's checks side by side and sends each answer as a line of JSON the moment
// it comes, then the report as saved. The checks take from under a second (the byline) to about ten (Already published).
export async function POST(request: Request) {
  const who = await actor();
  if (!who) return Response.json({ error: "Sign in to publish." }, { status: 401 });
  const { id, metadata, correction } = (await request.json().catch(() => ({}))) as { id?: unknown; metadata?: unknown; correction?: unknown };
  if (typeof id !== "string" || !isMetadata(metadata)) return Response.json({ error: "The report's details are missing." }, { status: 400 });
  let prepared;
  try {
    prepared = await checksFor(id, who, metadata, correction === true);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The checks couldn't start." }, { status: 409 });
  }
  const { settings, draft, text, checks, version } = prepared;
  const run = draft.run!;
  const encoder = new TextEncoder();
  // A reader that left, by a reload or a closed tab, stops the lines and nothing else: the checks still finish and
  // their outcome is still saved, so what the author sent is never lost with the page.
  let listening = true;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: object) => {
        if (!listening) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          listening = false;
        }
      };
      const results: CheckResult[] = await Promise.all(
        checks.map(async (check) => {
          const result = await runCheck(check, settings, draft, text, metadata).catch((error: unknown): CheckResult => {
            console.error("[publish mock] check failed", { check: check.id, error: String(error) });
            // A check that can't answer holds the report for a person rather than pass it. Why it couldn't is the
            // server log's to keep: an author is told only that it didn't finish.
            return { checkId: check.id, name: check.name, model: check.model.name, pass: false, blocking: false, errored: true, detail: "This check couldn't finish." };
          });
          send({ type: "result", result: { ...result, model: "" } });
          return result;
        }),
      );
      try {
        const origin = new URL(request.url).origin;
        // A correction to a live report says whether it was taken; a first run decides where the report stands.
        if (correction === true) {
          const { draft: saved, applied } = await finishCorrection(id, run, metadata, results, version, origin);
          send({ type: "done", draft: forAuthor(saved), applied });
        } else send({ type: "done", draft: forAuthor(await finishChecks(id, run, metadata, results, version, origin)), applied: true });
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : "The checks couldn't be saved." });
      }
      if (listening) controller.close();
    },
    cancel() {
      listening = false;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}

