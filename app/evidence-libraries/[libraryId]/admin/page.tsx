import { auth } from "@clerk/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { redirect } from "next/navigation";
import {
  AdminExpiredLinkPanel,
  AdminNoAccessPanel,
  AdminNotReadyPanel,
} from "@/components/evidence-libraries/admin-panels";
import { PageWrapper } from "@/components/PageWrapper";
import { api } from "@/convex/_generated/api";
import {
  buildAdminRouteHref,
  decideAdminHandoff,
  readAdminReturnPath,
  shouldRequestAdminHandoff,
  type AdminHandoffResult,
} from "@/lib/evidence-libraries/admin-handoff";

/**
 * The handover page. A library sends people here when they open its admin
 * area without a session. Clerk's middleware signs them in first, then this
 * page asks the backend once and either sends them to the library with a
 * fresh code or explains why it cannot.
 */
export default async function EvidenceLibraryAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ libraryId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { libraryId } = await params;
  const query = await searchParams;
  const returnPath = readAdminReturnPath(query.return);
  const retryHref = buildAdminRouteHref({ libraryId, returnPath });

  let result: AdminHandoffResult | null = null;
  if (shouldRequestAdminHandoff(query.error)) {
    const token = await (await auth()).getToken({ template: "convex" });
    if (!token) {
      redirect(`/sign-in?redirect_url=${encodeURIComponent(retryHref)}`);
    }
    result = await fetchAction(
      api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
      { libraryId, returnPath },
      { token },
    );
  }

  const view = decideAdminHandoff({ errorParam: query.error, result });
  if (view.kind === "launch") {
    redirect(view.launchUrl);
  }

  return (
    <PageWrapper>
      {view.kind === "no_access" ? (
        <AdminNoAccessPanel organisationName={view.organisationName} />
      ) : view.kind === "not_ready" ? (
        <AdminNotReadyPanel
          isOwner={view.isOwner}
          setupHref={`/evidence-libraries/${encodeURIComponent(libraryId)}/setup`}
        />
      ) : (
        <AdminExpiredLinkPanel retryHref={retryHref} />
      )}
    </PageWrapper>
  );
}
