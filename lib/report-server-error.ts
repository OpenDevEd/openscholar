import { PostHog } from "posthog-node";
import { UNNAMED_ACCOUNT } from "@/convex/lib/analyticsEvents";

/**
 * A server error as PostHog gets it. The server can't tell whether the person whose request failed
 * accepted analytics, and a message can hold what they typed, so it keeps only the type and the
 * frames. The digest finds the whole error in the server's log.
 */
export function withoutDetails(error: unknown): Error {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : "";
  const report = new Error(digest ? `Server error ${digest}` : "Server error");
  if (error instanceof Error) report.name = error.name;
  report.stack = [`${report.name}: ${report.message}`, ...framesOf(error)].join("\n");
  return report;
}

/** The lines of a stack after its message, which can itself hold a line that looks like a frame. No message to cut, no frames. */
function framesOf(error: unknown) {
  if (!(error instanceof Error) || !error.stack) return [];
  const end = error.stack.indexOf(error.message);
  if (end === -1) return [];
  return error.stack.slice(end + error.message.length).split("\n").filter((line) => line.startsWith("    at "));
}

// Serverless-style settings: the report goes before the request ends, not in a later batch.
let client: PostHog | undefined;
const postHog = (key: string) => (client ??= new PostHog(key, { host: process.env.POSTHOG_HOST || "https://eu.i.posthog.com", flushAt: 1, flushInterval: 0 }));

/** Reports an error from a page, a server action or a route. A deployment without `POSTHOG_KEY` sends nothing. Reporting never fails the request. */
export async function reportServerError(error: unknown, request: { headers: Record<string, string | string[] | undefined> }, context: { routePath: string; routeType: string }) {
  const key = process.env.POSTHOG_KEY;
  if (!key) return;
  try {
    await postHog(key).captureExceptionImmediate(withoutDetails(error), UNNAMED_ACCOUNT, {
      $process_person_profile: false,
      environment: request.headers.host,
      // The route as written, /authors/[id]: an address can hold anything.
      route: context.routePath,
      route_type: context.routeType,
    });
  } catch (failure) {
    console.error("[report-server-error] PostHog refused the report", failure);
  }
}
