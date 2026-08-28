import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import {
  AdminExpiredLinkPanel,
  AdminNoAccessPanel,
  AdminNotReadyPanel,
  AdminOpenAdminPanel,
} from "@/components/evidence-libraries/admin-panels";
import { PageWrapper } from "@/components/PageWrapper";
import { api } from "@/convex/_generated/api";
import {
  buildAdminRouteHref,
  readAdminReturnPath,
} from "@/lib/evidence-libraries/admin-handoff";

/**
 * Why the admin area did not open. The admin route sends people here after
 * it has decided; this page only explains, and never hands out a code.
 */
export default async function EvidenceLibraryAdminStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ libraryId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { libraryId } = await params;
  const query = await searchParams;
  const returnPath = readAdminReturnPath(query.return);
  const adminHref = buildAdminRouteHref({ libraryId, returnPath });

  if (query.state === "expired_link") {
    return (
      <PageWrapper>
        <AdminExpiredLinkPanel retryHref={adminHref} />
      </PageWrapper>
    );
  }

  const token = await (await auth()).getToken({ template: "convex" });
  if (!token) redirect(`/sign-in?redirect_url=${encodeURIComponent(adminHref)}`);

  const state = await fetchQuery(
    api.evidenceLibraries.adminHandoff.readAdminHandoffState,
    { libraryId },
    { token },
  );

  return (
    <PageWrapper>
      {state.status === "no_access" ? (
        <AdminNoAccessPanel organisationName={state.organisationName} />
      ) : state.status === "not_ready" ? (
        <AdminNotReadyPanel
          isOwner={state.isOwner}
          setupHref={`/evidence-libraries/${encodeURIComponent(libraryId)}/setup`}
        />
      ) : (
        <AdminOpenAdminPanel adminHref={adminHref} />
      )}
    </PageWrapper>
  );
}
