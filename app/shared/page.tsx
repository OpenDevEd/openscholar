import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { getTranslations } from "next-intl/server";
import { PageWrapper } from "@/components/PageWrapper";
import { createLoader } from "nuqs/server";
import { SharedWithMe } from "@/components/workspaces/shared";
import { api } from "@/convex/_generated/api";
import { SHARED_PAGE, SHARED_PLACE } from "@/lib/sharing";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("sharedTitle") };
}

// What people outside your workspaces shared with you (#653). It has no page under /o/<slug>:
// a shared item is in your own workspace. The list arrives with the page, so it's there from the
// first frame.
export default async function SharedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // The view the address names, so the first rows are the ones it shows.
  const place = createLoader(SHARED_PLACE)(await searchParams);
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const workspaceId = token ? await fetchQuery(api.workspaces.queries.personal, {}, { token }) : null;
  const initial = workspaceId
    ? await Promise.all([
        fetchQuery(api.sharing.shared.counts, { workspaceId }, { token }),
        fetchQuery(api.sharing.shared.list, { workspaceId, sort: place.sort, ...(place.kind ? { kind: place.kind } : {}), ...(place.q.trim() ? { text: place.q.trim() } : {}), paginationOpts: { cursor: null, numItems: SHARED_PAGE } }, { token }),
        fetchQuery(api.sharing.invitations.waiting, { workspaceId }, { token }),
      ]).then(([counts, first, waiting]) => ({ counts, rows: first.page, invitations: waiting.page }))
    : undefined;
  return (
    <PageWrapper>
      <SharedWithMe initial={initial} />
    </PageWrapper>
  );
}
