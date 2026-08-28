import { auth } from "@clerk/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import {
  buildAdminRouteHref,
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

  const token = await (await auth()).getToken({ template: "convex" });
  if (!token) {
    const target = buildAdminRouteHref({ libraryId, returnPath });
    return seeOther(`/sign-in?redirect_url=${encodeURIComponent(target)}`);
  }

  const result: AdminHandoffResult = await fetchAction(
    api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
    { libraryId, returnPath },
    { token },
  );
  if (result.status === "allowed") return seeOther(result.launchUrl);
  return seeOther(buildAdminStatusHref({ libraryId, returnPath }));
}
