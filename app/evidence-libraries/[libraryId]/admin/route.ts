import { auth } from "@clerk/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import {
  buildAdminStatusHref,
  readAdminReturnPath,
  shouldRequestAdminHandoff,
  type AdminHandoffResult,
} from "@/lib/evidence-libraries/admin-handoff";

/**
 * The address a library sends people to when they open its admin area
 * without a session. It answers with a redirect and nothing else: to the
 * library with a fresh code when the person may go there, or to the page
 * that explains why they cannot.
 *
 * It is a route handler, not a page, so the answer is a real `303` with a
 * `Location` header for every client, not only browsers that run JavaScript.
 */
function seeOther(location: string) {
  return new Response(null, {
    status: 303,
    headers: { location, "cache-control": "no-store" },
  });
}

/**
 * Every request here spends a single-use code, so only a real `GET` may run.
 * Next answers `HEAD` with `GET` unless a `HEAD` is exported, and a browser,
 * a link checker or a preview card would then burn somebody's code.
 */
function methodNotAllowed() {
  return new Response(null, {
    status: 405,
    headers: { allow: "GET", "cache-control": "no-store" },
  });
}

export const HEAD = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
// Without this Next answers OPTIONS itself, with no `no-store` and a list of
// every method it thinks this file serves.
export const OPTIONS = methodNotAllowed;

export async function GET(
  request: Request,
  context: { params: Promise<{ libraryId: string }> },
) {
  const { libraryId } = await context.params;
  const { searchParams } = new URL(request.url);
  const returnPath = readAdminReturnPath(
    searchParams.get("return") ?? undefined,
  );

  // The library reported a code it could not use. Asking for another one now
  // would bounce the browser between the two sites, so explain instead.
  if (!shouldRequestAdminHandoff(searchParams.get("error") ?? undefined)) {
    return seeOther(
      buildAdminStatusHref({ libraryId, returnPath, state: "expired_link" }),
    );
  }

  // Clerk's middleware signs people in before this runs, so a missing token
  // means the sign-in setup is broken, not that somebody is signed out.
  const token = await (await auth()).getToken({ template: "convex" });
  if (!token) {
    console.error(
      "Evidence Library admin handoff: signed-in request carried no Convex token",
      { libraryId },
    );
    return new Response("The admin area could not be opened. Try again.", {
      status: 500,
      headers: { "cache-control": "no-store", "content-type": "text/plain" },
    });
  }

  const result: AdminHandoffResult = await fetchAction(
    api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
    { libraryId, returnPath },
    { token },
  );
  if (result.status === "allowed") return seeOther(result.launchUrl);
  return seeOther(buildAdminStatusHref({ libraryId, returnPath }));
}
